import { NextResponse, NextRequest } from "next/server";
import { reviewPullRequest } from "@/module/ai/actions";
import { rateLimit } from "@/lib/rate-limit";

// Verify GitHub webhook HMAC-SHA256 signature
async function verifyGitHubSignature(
    payload: string,
    signature: string | null,
    secret: string,
): Promise<boolean> {
    if (!signature) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );

    const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const expected = `sha256=${Array.from(new Uint8Array(signed)).map((b) => b.toString(16).padStart(2, "0")).join("")}`;

    // Constant-time comparison
    if (expected.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
        mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
}

export async function POST(req: NextRequest){
    try{
        // Rate limit: 60 webhook calls per minute per IP
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        const rl = rateLimit(`webhook:${ip}`, 60, 60_000);
        if (!rl.allowed) {
            return NextResponse.json({ message: "Too many requests" }, { status: 429 });
        }

        const rawBody = await req.text();

        // Verify HMAC signature
        const secret = process.env.GITHUB_WEBHOOK_SECRET;
        if (secret) {
            const signature = req.headers.get("x-hub-signature-256");
            const valid = await verifyGitHubSignature(rawBody, signature, secret);
            if (!valid) {
                console.error("Invalid webhook signature");
                return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
            }
        } else {
            console.warn("GITHUB_WEBHOOK_SECRET not set — webhook signature verification disabled");
        }

        const body = JSON.parse(rawBody);
        const event = req.headers.get("x-github-event");
        console.log(`received github event :${event}`);

        if(event ==="ping"){
            return NextResponse.json({message: "Pong"}, {status:200})
        }

        if(event === "pull_request"){
            const action = body.action;
            const repo = body.repository?.full_name;
            const prNumber = body.number;

            if (!repo || typeof prNumber !== "number") {
                return NextResponse.json({ message: "Invalid payload" }, { status: 400 });
            }

            const[owner,repoName]= repo.split("/")

            if(action === "opened" || action === "synchronize"){
                reviewPullRequest(owner,repoName,prNumber)
                .then(()=>console.log(`review completed for ${repo}#${prNumber}`))
                .catch((error)=>console.error(`Failed to review ${repo}#${prNumber}:`,error))
            }
        }

        return NextResponse.json({message: "Event Processed"}, {status:200})
    }catch(error){
        console.error("Error processing webhook:", error)
        return NextResponse.json({message: "Internal Server Error"}, {status:500})
    }
}