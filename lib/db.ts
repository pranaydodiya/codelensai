import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 60000, // 60 seconds for Neon wake-up
    idleTimeoutMillis: 60000,
    max: 10,
});

const prismaClientSingleton = () => {
    return new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
};

declare const globalThis: {
    prismaGlobal?: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal || prismaClientSingleton();

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = prisma;

// Retry connection on startup to handle Neon cold-start / DNS delays
async function connectWithRetry(retries = 5, delayMs = 3000) {
    for (let i = 1; i <= retries; i++) {
        try {
            await prisma.$connect();
            if (i > 1) console.log(`✅ Database connected on attempt ${i}`);
            return;
        } catch (err: any) {
            const isNetworkError =
                err?.message?.includes("ENOTFOUND") ||
                err?.message?.includes("ECONNREFUSED") ||
                err?.message?.includes("ETIMEDOUT");
            if (isNetworkError && i < retries) {
                console.warn(`⚠️  DB attempt ${i} failed (Neon waking up), retrying in ${delayMs / 1000}s...`);
                await new Promise((res) => setTimeout(res, delayMs));
            } else {
                // Non-network error or out of retries — let individual queries fail naturally
                console.error(`❌ DB connection failed after ${i} attempt(s):`, err?.message);
                return;
            }
        }
    }
}

// Fire-and-forget on module load (server only)
if (typeof window === "undefined") {
    connectWithRetry();
}

export default prisma;