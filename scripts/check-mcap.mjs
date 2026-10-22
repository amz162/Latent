import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const withMcap = await prisma.stock.count({ where: { marketCap: { not: null } } });
const sum = await prisma.stock.aggregate({ _sum: { marketCap: true }, where: { marketCap: { not: null } } });
console.log(`Stocks with marketCap: ${withMcap}`);
console.log(`Sum of marketCap: ${sum._sum.marketCap}`);
console.log(`Sum in billions: ${sum._sum.marketCap ? (sum._sum.marketCap / 1e9).toFixed(2) : 'null'}`);
console.log(`Sum in trillions (PKR): ${sum._sum.marketCap ? (sum._sum.marketCap / 1e12).toFixed(2) : 'null'}`);
// Sample some marketCap values to see scale
const samples = await prisma.stock.findMany({ where: { marketCap: { not: null } }, select: { symbol: true, marketCap: true }, take: 5, orderBy: { marketCap: 'desc' } });
console.log('\nTop 5 by marketCap:');
for (const s of samples) console.log(`  ${s.symbol}: ${s.marketCap}`);
await prisma.$disconnect();
