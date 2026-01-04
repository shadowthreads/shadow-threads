/**
 * API 路由入口
 */
import stateSnapshotsRouter from './stateSnapshots';
import { Router } from 'express';
import systemRouter from './system';
import subthreadsRouter from './subthreads';
import usersRouter from './users';

const router = Router();

// 系统路由（不需要前缀）
router.use('/', systemRouter);

// 业务路由
router.use('/subthreads', subthreadsRouter);
router.use('/users', usersRouter);
router.use('/state-snapshots', stateSnapshotsRouter);

export default router;
