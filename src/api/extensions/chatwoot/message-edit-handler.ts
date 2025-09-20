import { InstanceDto } from '@api/dto/instance.dto';
import { ExtendedMessageKey } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';

interface HandleChatwootMessageUpdatedParams {
  body: any;
  instance: InstanceDto;
  prismaRepository: PrismaRepository;
  waInstance: any;
  logger: Logger;
  resolvedInstanceId?: string | number;
}

/**
 * Process Chatwoot webhook message updates (edition) and mirrors the change back to WhatsApp.
 * Returns true when the event was handled (or safely ignored) so the caller can stop further processing.
 */
export const handleChatwootMessageUpdated = async ({
  body,
  instance,
  prismaRepository,
  waInstance,
  logger,
  resolvedInstanceId,
}: HandleChatwootMessageUpdatedParams): Promise<boolean> => {
  if (body?.event !== 'message_updated' || !body?.content_attributes?.edited) {
    return false;
  }

  logger.debug(
    'handleChatwootMessageUpdated: received payload ' +
      JSON.stringify({
        chatwootId: body?.id,
        edited: body?.content_attributes?.edited,
        hasNewContent: Boolean(body?.content_attributes?.newContent),
        instancePayload: instance?.instanceId,
        resolvedInstanceId,
      }),
  );

  if (!waInstance) {
    logger.warn('handleChatwootMessageUpdated: wa instance not found for message update');
    return true;
  }

  const newContent: string | undefined = body.content_attributes?.newContent;

  if (!newContent) {
    logger.warn('handleChatwootMessageUpdated: message update received without newContent payload');
    return true;
  }

  const messageId = Number(body.id);

  if (Number.isNaN(messageId)) {
    logger.warn(
      'handleChatwootMessageUpdated: message update payload with invalid id ' + JSON.stringify({ id: body?.id }),
    );
    return true;
  }

  const rawInstanceId = resolvedInstanceId ?? instance.instanceId;

  if (!rawInstanceId) {
    logger.warn(
      'handleChatwootMessageUpdated: message update without valid instanceId ' +
        JSON.stringify({ payloadId: body?.id, instancePayload: instance?.instanceId, resolvedInstanceId }),
    );
    return true;
  }

  const instanceId = String(rawInstanceId);

  const message = await prismaRepository.message.findFirst({
    where: {
      chatwootMessageId: messageId,
      instanceId,
    },
  });

  if (!message) {
    logger.warn(
      'handleChatwootMessageUpdated: message update target not found in prisma ' +
        JSON.stringify({ chatwootMessageId: messageId, instanceId }),
    );
    return true;
  }

  const key = message.key as ExtendedMessageKey | undefined;

  if (!key?.id || !key.remoteJid) {
    logger.warn(
      'handleChatwootMessageUpdated: message update missing key identifiers ' +
        JSON.stringify({ key, chatwootMessageId: messageId }),
    );
    return true;
  }

  try {
    logger.debug(
      'handleChatwootMessageUpdated: forwarding edit to WhatsApp ' +
        JSON.stringify({ remoteJid: key.remoteJid, keyId: key.id }),
    );
    await waInstance.client?.sendMessage(key.remoteJid, {
      text: newContent,
      edit: key,
    });
  } catch (error) {
    logger.error(
      'handleChatwootMessageUpdated: error forwarding edited message to WhatsApp ' +
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  }

  const existingPayload = message.message;
  const baseMessage =
    existingPayload && typeof existingPayload === 'object' && !Array.isArray(existingPayload)
      ? { ...(existingPayload as Record<string, unknown>) }
      : {};

  const updatedMessage = {
    ...baseMessage,
    conversation: newContent,
  };

  logger.debug(
    'handleChatwootMessageUpdated: updating message record ' +
      JSON.stringify({ instanceId, chatwootMessageId: messageId }),
  );

  await prismaRepository.message.updateMany({
    where: {
      instanceId,
      chatwootMessageId: messageId,
    },
    data: {
      message: updatedMessage,
    },
  });

  return true;
};
