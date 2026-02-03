-- Drop the old constraint and create a new one with all action types
ALTER TABLE sequence_steps DROP CONSTRAINT sequence_steps_action_type_check;

ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_action_type_check 
CHECK (action_type = ANY (ARRAY[
  'inmail'::text, 
  'connection_request'::text, 
  'profile_visit'::text, 
  'message'::text,
  'smart_message'::text,
  'wait_connection'::text,
  'wait_reply'::text,
  'wait_profile_visit'::text,
  'condition_branch'::text,
  'check_connection'::text
]));