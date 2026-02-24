ALTER TABLE public.style_groups
ADD COLUMN licensor_id UUID REFERENCES public.licensors(id) ON DELETE SET NULL,
ADD COLUMN property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;

CREATE INDEX idx_style_groups_licensor_id ON public.style_groups(licensor_id);
CREATE INDEX idx_style_groups_property_id ON public.style_groups(property_id);