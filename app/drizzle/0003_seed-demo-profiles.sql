INSERT INTO demo_profiles (id, name, visibility) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Standard', 'public'),
  ('00000000-0000-0000-0000-000000000002', 'Compliance', 'compliance')
ON CONFLICT (id) DO NOTHING;