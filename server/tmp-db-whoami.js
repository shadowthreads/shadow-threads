const { PrismaClient } = require("@prisma/client");

(async () => {
  const prisma = new PrismaClient();
  try {
    // 1) 打印 prisma 看到的 datasource URL（注意：可能会被 prisma 隐藏密码）
    console.log("ENV_DATABASE_URL =", process.env.DATABASE_URL);

    // 2) 直接问 Postgres：我是谁、我在哪个 DB、我在哪个 schema
    const rows = await prisma.$queryRaw`
      SELECT
        current_database() AS db,
        current_schema() AS schema,
        current_user AS user,
        inet_server_addr()::text AS server_addr,
        inet_server_port() AS server_port
    `;
    console.log("WHOAMI =", rows);

    // 3) 看 StateSnapshot 表到底有没有行（用 count 走 ORM）
    const count = await prisma.stateSnapshot.count();
    console.log("StateSnapshot.count() =", count);
  } catch (e) {
    console.error("DB_ERROR =", e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();