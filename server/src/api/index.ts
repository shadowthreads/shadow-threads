/**
 * API 路由入口
 * 
 * 分层说明：
 * - system    : 健康检查 / providers / 基础能力
 * - domain    : 现有业务实体（subthreads / users）
 * - protocol  : 状态 / 迁移 / apply（协议层，核心演进方向）
 * - debug     : 仅开发环境使用
 */

import { Router, type Router as ExpressRouter } from 'express';

import systemRouter from './system';
import usersRouter from './users';
import subthreadsRouter from './subthreads';

import stateSnapshotsRouter from './stateSnapshots';
import taskPackagesRouter from './taskPackages';
import debugRouter from './debug';

const router: ExpressRouter = Router();

/**
 * ============================
 * System / Meta
 * ============================
 * /health
 * /providers
 */
router.use('/', systemRouter);

/**
 * ============================
 * Domain Layer（现有产品层）
 * ============================
 * 注意：这些是“工具期”实体
 */
router.use('/users', usersRouter);
router.use('/subthreads', subthreadsRouter);

/**
 * ============================
 * Protocol Layer（关键）
 * ============================
 * 所有“可迁移 / 可 apply / 可脱离对话”的能力
 * 都必须在这一层演进
 *
 * 当前：
 * - StateSnapshot（事实状态）
 *
 * 未来（P2 / P3）：
 * - TaskPackage / MigrationPackage
 * - Apply Contract
 */
router.use('/state-snapshots', stateSnapshotsRouter);

router.use('/task-packages', taskPackagesRouter);
/**
 * ============================
 * Debug / Dev only
 * ============================
 */
router.use('/debug', debugRouter);

export default router;