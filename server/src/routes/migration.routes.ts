import { Router } from 'express';
import { exportMigration, importMigration, verifyMigration } from '../controllers/migration.controller';

const router = Router();

router.post('/export', exportMigration);
router.post('/verify', verifyMigration);
router.post('/import', importMigration);

export default router;
