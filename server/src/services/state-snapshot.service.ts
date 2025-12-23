/**
 * StateSnapshot Service
 * Phase 2.1: 只负责生成与存储 StateSnapshot v1
 */

import { prisma, logger } from '../utils';

export type StateSnapshotV1 = {
  anchorIntent: {
    description: string;
  };

  effectiveContext: {
    strategy: 'WINDOW_L1';
    summary?: string;
  };

  thoughtTrajectory: {
    conclusions: string[];
    rejected?: string[];
  };

  continuationContract: {
    assumptions: string[];
    instructions?: string[];
  };
};

export class StateSnapshotService {
  async createFromSubthread(params: {
    userId: string;
    subthreadId: string;
    snapshot: StateSnapshotV1;
  }) {
    const { userId, subthreadId, snapshot } = params;

    try {
      return await prisma.stateSnapshot.create({
        data: {
          userId,
          subthreadId,
          snapshot,
          version: 'v1',
        },
      });
    } catch (error) {
      logger.error('Failed to create StateSnapshot', {
        userId,
        subthreadId,
        error,
      });
      throw error;
    }
  }
}