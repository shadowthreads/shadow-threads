import { Router } from 'express';
import { createArtifact, getArtifact, verifyArtifact } from '../controllers/artifact.controller';

const router = Router();

router.post('/', createArtifact);
router.get('/:packageId/:bundleHash', getArtifact);
router.post('/:packageId/:bundleHash/verify', verifyArtifact);

export default router;
