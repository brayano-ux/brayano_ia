/** File d'attente par clé : les opérations d'une même conversation s'exécutent l'une après l'autre, dans l'ordre d'arrivée. */
function createKeyedQueue() {
  const tails = new Map<string, Promise<void>>();
  return async function runInQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const currentGate = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const currentTail = previous.then(() => currentGate);
    tails.set(key, currentTail);

    await previous;
    try {
      return await operation();
    } finally {
      releaseCurrent();
      if (tails.get(key) === currentTail) {
        tails.delete(key);
      }
    }
  };
}

const sendQueue = createKeyedQueue();
const replyQueue = createKeyedQueue();

/** Protège l'ENVOI d'un message et son enregistrement : deux envois dans la même conversation ne se croisent jamais. */
export function withConversationSendLock<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
  return sendQueue(conversationId, operation);
}

/**
 * Une seule réponse de l'assistant en préparation par conversation (lecture de l'historique, appel à l'IA, envoi).
 * La réponse suivante ne démarre qu'une fois la précédente enregistrée : elle la voit donc dans l'historique et ne
 * la répète pas. File distincte de celle des envois, qui est prise à l'intérieur de cette opération.
 */
export function withConversationReplyQueue<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
  return replyQueue(conversationId, operation);
}
