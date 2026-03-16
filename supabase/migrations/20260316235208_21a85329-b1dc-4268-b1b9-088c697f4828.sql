INSERT INTO storage.buckets (id, name, public) VALUES ('org-logos', 'org-logos', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Org members can upload logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'org-logos' AND (storage.foldername(name))[1] = (SELECT active_organization_id::text FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Org logos are publicly readable"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'org-logos');

CREATE POLICY "Org admins can delete logos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'org-logos' AND (storage.foldername(name))[1] = (SELECT active_organization_id::text FROM public.profiles WHERE user_id = auth.uid()));