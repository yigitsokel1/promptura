/**
 * Set a user's role to ADMIN by email.
 * Usage: node scripts/set-admin.js <email>
 * Example: node scripts/set-admin.js user@example.com
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node script
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const email = process.argv[2];

if (!email) {
  console.error('Usage: node scripts/set-admin.js <email>');
  process.exit(1);
}

async function main() {
  const result = await prisma.user.updateMany({
    where: { email },
    data: { role: 'ADMIN' },
  });
  if (result.count === 0) {
    console.error('No user found with email:', email);
    process.exit(1);
  }
  console.log('Updated', result.count, 'user(s) to ADMIN:', email);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
