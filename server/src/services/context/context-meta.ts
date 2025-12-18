export type ContextMeta = {
  strategy: 'WINDOW_L1';
  aboveTarget: number;
  belowTarget: number;
  aboveCount: number;
  belowCount: number;
  clipped: boolean;
  clipReason?: 'BUDGET' | 'UNAVAILABLE' | 'OTHER';
  tokenEstimate?: number;
  anchor: {
    conversationId: string;
    messageId: string;
    messageRole?: string;
  };
};

export function buildContextMetaL1(input: {
  conversationId: string;
  messageId: string;
  messageRole?: string;
  aboveTarget?: number;
  belowTarget?: number;
  tokenEstimate?: number;
  hasConversationDump?: boolean; // 如果你们未来能拿到完整对话，可接入
}): ContextMeta {
  const aboveTarget = input.aboveTarget ?? 8;
  const belowTarget = input.belowTarget ?? 0;

  const available = !!input.hasConversationDump;

  return {
    strategy: 'WINDOW_L1',
    aboveTarget,
    belowTarget,
    aboveCount: available ? Math.min(aboveTarget, 0) : 0,
    belowCount: available ? Math.min(belowTarget, 0) : 0,
    clipped: !available,                 // PR-B2：拿不到上下文就视为 clipped
    clipReason: !available ? 'UNAVAILABLE' : undefined,
    tokenEstimate: input.tokenEstimate,
    anchor: {
      conversationId: input.conversationId,
      messageId: input.messageId,
      messageRole: input.messageRole
    }
  };
}