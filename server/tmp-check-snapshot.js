const { PrismaClient } = require("@prisma/client");

const SNAPSHOT_ID = "b2d4e260-54af-408a-9363-7e6a38ecc8b6";

(async () => {
  const prisma = new PrismaClient();
  try {
    const row = await prisma.stateSnapshot.findUnique({
      where: { id: SNAPSHOT_ID },
      select: { id: true, userId: true, version: true, createdAt: true },
    });

    console.log("findUnique =", row);

    // 额外：查最新一条，确认这张表到底有没有写入
    const latest = await prisma.stateSnapshot.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true, version: true, createdAt: true },
    });
    console.log("latest =", latest);

    const count = await prisma.stateSnapshot.count();
    console.log("count =", count);
  } catch (e) {
    console.error("DB_ERROR =", e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();