import { Router } from 'express';
import { createRevision, getRevision, listRevisions } from '../controllers/revision.controller';

const router = Router();

router.post('/', createRevision);
router.get('/package/:packageId', listRevisions);
router.get('/:revisionHash', getRevision);

export default router;
