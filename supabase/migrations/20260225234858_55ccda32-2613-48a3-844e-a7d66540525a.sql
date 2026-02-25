ALTER TABLE agent_pairings
  DROP CONSTRAINT agent_pairings_agent_registration_id_fkey;

ALTER TABLE agent_pairings
  ADD CONSTRAINT agent_pairings_agent_registration_id_fkey
  FOREIGN KEY (agent_registration_id) REFERENCES agent_registrations(id) ON DELETE CASCADE;