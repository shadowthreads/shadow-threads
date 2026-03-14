import { Router } from 'express';
import { getExecution, recordExecution, replayExecution } from '../controllers/execution.controller';

const router = Router();

router.post('/', recordExecution);
router.get('/:executionId', getExecution);
router.post('/:executionId/replay', replayExecution);

export default router;
