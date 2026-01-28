import { Router, Request, Response } from 'express';
import { asyncHandler, requireAuth } from '../middleware';
import { prisma } from '../utils';

const router = Router();

/**
 * POST /debug/pin-inputs
 * 用于盘点“Pin Snapshot 那一刻，系统能拿到哪些输入”
 *
 * body:
 * - subthreadId: string (required)
 */
router.post(
  '/pin-inputs',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;
    const subthreadId = String((req.body as any)?.subthreadId || '').trim();

    if (!subthreadId) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'missing subthreadId' } });
      return;
    }

    // 1) 取 subthread（带 sourceContext）
    const subthread = await prisma.subthread.findUnique({
      where: { id: subthreadId },
      select: {
        id: true,
        userId: true,
        provider: true,
        model: true,
        sourceContext: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!subthread) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'subthread not found' } });
      return;
    }

    if (subthread.userId !== userId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'subthread not owned by this user' } });
      return;
    }

    // 2) 取 messages（Δ）
    const messages = await prisma.subthreadMessage.findMany({
      where: { subthreadId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true
      }
    });

    // 3) 从 sourceContext 里拆 S / W / I（如果你 sourceContext 结构不同，先按 raw 输出即可）
    const sc: any = subthread.sourceContext || {};

    const selectionText =
      typeof sc.selectionText === 'string' ? sc.selectionText : '';

    const cm = (sc?.contextMeta as any)?.contextMessages;
    const contextMessages = Array.isArray(cm) ? cm : [];

    const meta = {
      platform: sc.platform,
      conversationId: sc.conversationId,
      conversationUrl: sc.conversationUrl,
      messageId: sc.messageId,
      messageRole: sc.messageRole
    };

    // 4) 输出一个非常清晰的“盘点结果”
    res.json({
      success: true,
      data: {
        subthread: {
          id: subthread.id,
          provider: subthread.provider,
          model: subthread.model,
          createdAt: subthread.createdAt,
          updatedAt: subthread.updatedAt
        },

        capturePack: {
          S: {
            exists: Boolean(selectionText && selectionText.trim()),
            length: selectionText?.length || 0,
            preview: (selectionText || '').slice(0, 400)
          },
          W: {
            exists: Array.isArray(contextMessages) && contextMessages.length > 0,
            count: Array.isArray(contextMessages) ? contextMessages.length : 0,
            sample: Array.isArray(contextMessages)
              ? contextMessages.slice(0, 3)
              : []
          },
          Delta: {
            exists: messages.length > 0,
            count: messages.length,
            roles: Array.from(new Set(messages.map((m: any) => m.role))),
            preview: messages.slice(-4).map((m: any) => ({
              role: m.role,
              len: (m.content || '').length,
              contentPreview: String(m.content || '').slice(0, 200)
            }))
          },
          I: meta
        },

        raw: {
          sourceContext: sc // ✅ 最重要：保留原样，避免我们猜结构
        }
      }
    });
  })
);

export default router;