-- WORLD TV D1 staging schema migration 004: atomically count chat messages.
-- Existing data is untouched. Only NEW inserted messages update unread totals.
-- Run only after approval on fresh D1 worldtv-fresh.
-- A message is the source of truth, so duplicate-looking recent text can never
-- incorrectly increment the counter and insertion failures don't increment it.
CREATE TRIGGER IF NOT EXISTS trg_worldtv_chat_customer_message
AFTER INSERT ON live_chat_messages
FOR EACH ROW
WHEN NEW.sender = 'customer'
BEGIN
  UPDATE live_chat_conversations
  SET unread_admin = unread_admin + 1,
      last_message_at = NEW.created_at,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.conversation_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_worldtv_chat_staff_message
AFTER INSERT ON live_chat_messages
FOR EACH ROW
WHEN NEW.sender IN ('admin','assistant')
BEGIN
  UPDATE live_chat_conversations
  SET unread_customer = unread_customer + 1,
      last_message_at = NEW.created_at,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.conversation_id;
END;
