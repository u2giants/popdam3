-- Create agent_pairings table for one-time pairing code flow
CREATE TABLE public.agent_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pairing_code text NOT NULL UNIQUE,
  agent_type text NOT NULL CHECK (agent_type IN ('bridge', 'windows-render')),
  agent_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consumed', 'expired')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_agent_id uuid,
  agent_registration_id uuid REFERENCES public.agent_registrations(id)
);

ALTER TABLE public.agent_pairings ENABLE ROW LEVEL SECURITY;

-- Only admins can manage pairing codes
CREATE POLICY "Admin manage agent_pairings"
  ON public.agent_pairings
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for fast lookup by pairing_code
CREATE INDEX idx_agent_pairings_code ON public.agent_pairings (pairing_code) WHERE status = 'pending';