/**
 * Blok A: Auth & role system (NextAuth v5 + Prisma)
 * - Google OAuth
 * - Role (ADMIN | USER) from DB, no hardcoded tokens
 * - JWT session strategy so middleware can run on Edge (no Prisma on Edge)
 */

import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/src/db/client';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: prisma ? PrismaAdapter(prisma) : undefined,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id?: string }).id;
        if (prisma) {
          const dbUser = await prisma.user.findUnique({
            where: { id: (user as { id?: string }).id },
            select: { role: true },
          });
          token.role = dbUser?.role ?? 'USER';
        } else {
          token.role = 'USER';
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.sub ?? token.id) as string;
        session.user.role = (token.role as string) ?? 'USER';
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
});
