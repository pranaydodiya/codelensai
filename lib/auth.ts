import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {polar , checkout , portal,usage,webhooks} from "@polar-sh/better-auth"
import {polarClient} from "@/module/payment/config/polar"
import prisma from "./db";
import { updatePolarCustomerId, updateUserTier } from "@/module/payment/lib/subscription";
import { encrypt, isEncryptionEnabled } from "./encryption";

export const auth = betterAuth({
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(prisma, {
        provider: "postgresql", 
    }),
    session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24,     // Rotate session token daily
    },
    databaseHooks: {
        account: {
            create: {
                before: async (account) => {
                    if (isEncryptionEnabled()) {
                        return {
                            data: {
                                ...account,
                                accessToken: account.accessToken ? encrypt(account.accessToken) : account.accessToken,
                                refreshToken: account.refreshToken ? encrypt(account.refreshToken) : account.refreshToken,
                                idToken: account.idToken ? encrypt(account.idToken) : account.idToken,
                            },
                        };
                    }
                },
            },
            update: {
                before: async (account) => {
                    if (isEncryptionEnabled()) {
                        const data: Record<string, unknown> = { ...account };
                        if (typeof data.accessToken === "string") data.accessToken = encrypt(data.accessToken);
                        if (typeof data.refreshToken === "string") data.refreshToken = encrypt(data.refreshToken);
                        if (typeof data.idToken === "string") data.idToken = encrypt(data.idToken);
                        return { data };
                    }
                },
            },
        },
    },
    socialProviders: {
        github: {
            clientId: process.env.GITHUB_CLIENT_ID!,
            clientSecret: process.env.GITHUB_CLIENT_SECRET!,
            scope: ["user:email", "read:user", "repo"],
        }
    },
    trustedOrigins: [
        "http://localhost:3000",
        ...(process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : []),
    ],
    plugins: [
        polar({
            client: polarClient,
            createCustomerOnSignUp: true,
            use: [
                checkout({
                    products: [
                        {
                            productId: process.env.POLAR_PRODUCT_ID!,
                            slug: "codelens" // Custom slug for easy reference in Checkout URL, e.g. /checkout/codelens
                        }
                    ],
                    successUrl: process.env.POLAR_SUCCESS_URL || "/dashboard/subscription?success=true",
                    authenticatedUsersOnly: true
                }),
                portal({
                    returnUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000/dashboard"
                }),
                usage(),
                webhooks({
                    secret: process.env.POLAR_WEBHOOK_SECRET!,
                    onSubscriptionActive: async(payload) => {  
                        const customerId = payload.data.customerId

                        const user = await prisma.user.findUnique({
                            where:{
                                polarCustomerId:customerId
                            }
                        });

                        if(user){
                            await updateUserTier(user.id,"PRO","ACTIVE",payload.data.id)
                        }
                        //
                    },
                     onSubscriptionCanceled : async(payload)=>{
                        const customerId = payload.data.customerId

                        const user = await prisma.user.findUnique({
                            where:{
                                polarCustomerId:customerId
                            }
                        });

                        if(user){
                            await updateUserTier(user.id,user.subscriptionTier as any, "CANCELED")
                        }
                     },
                     onSubscriptionRevoked:async(payload)=>{
                        const customerId = payload.data.customerId

                        const user = await prisma.user.findUnique({
                            where:{
                                polarCustomerId:customerId
                            }
                        });

                        if(user){
                            await updateUserTier(user.id,"FREE","EXPIRED")
                        }
                     },
                     onOrderPaid:async()=>{},
                     onCustomerCreated:async(payload)=>{
                        const customerId = payload.data.id

                        const user = await prisma.user.findUnique({
                            where:{
                                email:payload.data.email
                            }
                        });

                        if(user){
                            await updatePolarCustomerId(user.id,payload.data.id)
                        }
                     }
                })
            ],
        })
    ]
});