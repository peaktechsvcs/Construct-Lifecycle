import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Paintbrush, Check, RotateCcw, AlertTriangle, Play, Undo2 } from 'lucide-react';
import { 
  useGetBranding, getGetBrandingQueryKey,
  useSaveBrandingDraft, usePublishBranding, useResetBranding, useRollbackBranding,
  BrandingInput
} from '@workspace/api-client-react';
import { PageTitle, Button, LoadingPanel, ErrorPanel, Badge } from '@/components/app-ui';
import { hexToHsl } from '@/lib/color-utils';
import { getContrastRatio } from '@/lib/accessibility';

export function BrandingAdmin() {
  const qc = useQueryClient();
  const brandingQuery = useGetBranding({ query: { queryKey: getGetBrandingQueryKey() } });
  
  const saveDraft = useSaveBrandingDraft();
  const publish = usePublishBranding();
  const reset = useResetBranding();
  const rollback = useRollbackBranding();
  
  const [form, setForm] = useState<BrandingInput>({
    primaryColor: '#2563eb', // Vivid Blue default fallback
    secondaryColor: '#f1f5f9',
    accentColor: '#f1f5f9',
    backgroundColor: '#ffffff',
    foregroundColor: '#0f172a',
    logoUrl: '',
  });

  const initialized = useRef(false);

  useEffect(() => {
    if (brandingQuery.data && !initialized.current) {
      initialized.current = true;
      const draft = brandingQuery.data.draft || {};
      setForm({
        primaryColor: draft.primaryColor || '#2563eb',
        secondaryColor: draft.secondaryColor || '#f1f5f9',
        accentColor: draft.accentColor || '#f1f5f9',
        backgroundColor: draft.backgroundColor || '#ffffff',
        foregroundColor: draft.foregroundColor || '#0f172a',
        logoUrl: draft.logoUrl || '',
      });
    }
  }, [brandingQuery.data]);

  const handleChange = (key: keyof BrandingInput, value: string) => {
    const newForm = { ...form, [key]: value };
    setForm(newForm);
    // Auto-save draft logic (debounced)
    saveDraft.mutate({ data: newForm }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBrandingQueryKey() });
      }
    });
  };

  const handlePublish = () => {
    publish.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBrandingQueryKey() });
      }
    });
  };

  const handleReset = () => {
    if (window.confirm("Reset draft to published versions?")) {
      reset.mutate(undefined, {
        onSuccess: () => {
          initialized.current = false;
          qc.invalidateQueries({ queryKey: getGetBrandingQueryKey() });
        }
      });
    }
  };

  const handleRollback = (version: number) => {
    if (window.confirm(`Rollback to version ${version}?`)) {
      rollback.mutate({ version }, {
        onSuccess: () => {
          initialized.current = false;
          qc.invalidateQueries({ queryKey: getGetBrandingQueryKey() });
        }
      });
    }
  };

  if (brandingQuery.isLoading) return <><PageTitle eyebrow="Organization" title="Customer Branding" description="Customize Construct Lifecycle to match your organization's visual identity." /><LoadingPanel lines={6} /></>;
  if (brandingQuery.isError) return <ErrorPanel onRetry={() => brandingQuery.refetch()} />;

  const publishedVersions = brandingQuery.data?.published || [];
  
  // Create inline styles for live preview container
  const previewStyle = {
    '--primary': hexToHsl(form.primaryColor),
    '--secondary': hexToHsl(form.secondaryColor),
    '--accent': hexToHsl(form.accentColor),
    '--background': hexToHsl(form.backgroundColor),
    '--foreground': hexToHsl(form.foregroundColor),
  } as React.CSSProperties;

  return (
    <div className="animate-rise">
      <PageTitle eyebrow="Organization" title="Customer Branding" description="Customize Construct Lifecycle to match your organization's visual identity." action={
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={handleReset} disabled={reset.isPending}><RotateCcw size={15} /> Reset Draft</Button>
          <Button onClick={handlePublish} disabled={publish.isPending}><Check size={15} /> Publish Branding</Button>
        </div>
      } />
      
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-5 flex items-center gap-3 border-b border-border pb-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><Paintbrush size={16} /></span>
              <h2 className="text-base font-bold">Theme Colors</h2>
            </div>
            
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Primary Color</span>
                <div className="flex gap-2">
                  <input type="color" value={form.primaryColor} onChange={(e) => handleChange('primaryColor', e.target.value)} className="h-10 w-10 cursor-pointer rounded border border-input p-1" />
                  <input type="text" value={form.primaryColor} onChange={(e) => handleChange('primaryColor', e.target.value)} className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20" />
                </div>
              </label>
              
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Background Color</span>
                <div className="flex gap-2">
                  <input type="color" value={form.backgroundColor} onChange={(e) => handleChange('backgroundColor', e.target.value)} className="h-10 w-10 cursor-pointer rounded border border-input p-1" />
                  <input type="text" value={form.backgroundColor} onChange={(e) => handleChange('backgroundColor', e.target.value)} className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20" />
                </div>
              </label>
              
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Text Color (Foreground)</span>
                <div className="flex gap-2">
                  <input type="color" value={form.foregroundColor} onChange={(e) => handleChange('foregroundColor', e.target.value)} className="h-10 w-10 cursor-pointer rounded border border-input p-1" />
                  <input type="text" value={form.foregroundColor} onChange={(e) => handleChange('foregroundColor', e.target.value)} className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20" />
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Logo URL (Optional)</span>
                <input type="url" placeholder="https://..." value={form.logoUrl || ''} onChange={(e) => handleChange('logoUrl', e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20" />
              </label>
            </div>
            
            {publish.isError && (
              <div className="mt-5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>Publish failed. Please ensure contrast ratios are valid and try again.</span>
              </div>
            )}

            {/* Accessibility Feedback */}
            <div className="mt-6 border-t border-border pt-5">
              <h3 className="mb-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Accessibility</h3>
              
              {(() => {
                const ratio = getContrastRatio(form.foregroundColor || '#000000', form.backgroundColor || '#ffffff');
                const passes = ratio >= 4.5;
                return (
                  <div className={`flex items-start gap-3 rounded-lg p-3 text-sm ${passes ? 'bg-secondary/50 text-foreground' : 'bg-destructive/10 text-destructive'}`}>
                    <div className="mt-0.5 shrink-0">
                      {passes ? <Check size={16} className="text-emerald-500" /> : <AlertTriangle size={16} />}
                    </div>
                    <div>
                      <p className="font-bold">Text contrast {passes ? 'passes' : 'fails'} WCAG AA</p>
                      <p className={`text-xs mt-1 ${passes ? 'text-muted-foreground' : 'text-destructive/80'}`}>
                        Contrast ratio is {ratio.toFixed(2)}:1 between background and text color. {passes ? 'Good readability.' : 'Must be at least 4.5:1. Adjust colors to improve readability.'}
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </section>
          
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-bold">Version History</h2>
            {publishedVersions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No published versions yet.</p>
            ) : (
              <div className="space-y-3">
                {publishedVersions.sort((a, b) => b.version - a.version).map((v, i) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 border-b border-border/60 pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-xs font-semibold">Version {v.version} {i === 0 && <Badge tone="teal">Live</Badge>}</p>
                      <p className="text-[10px] text-muted-foreground">{new Date(v.publishedAt).toLocaleString()}</p>
                    </div>
                    {i !== 0 && (
                      <Button variant="ghost" className="h-7 px-2 py-0 text-[10px]" onClick={() => handleRollback(v.version)}>
                        <Undo2 size={12} /> Rollback
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        
        {/* Live Preview Pane */}
        <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-3">
            <Play size={14} className="text-primary" />
            <span className="text-xs font-bold">Live Preview</span>
          </div>
          <div className="flex-1 overflow-hidden p-6" style={{ backgroundColor: hexToHsl(form.backgroundColor || '') ? `hsl(${hexToHsl(form.backgroundColor || '')})` : 'hsl(var(--background))' }}>
            <div 
              className="live-preview-container mx-auto max-w-lg rounded-xl border border-border bg-background p-6 text-foreground shadow-2xl transition-all duration-300" 
              style={previewStyle}
            >
              <div className="mb-6 flex items-center gap-3">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt="Logo" className="h-8 w-8 object-contain" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">L</div>
                )}
                <span className="font-bold">Command Center</span>
              </div>
              
              <h1 className="text-2xl font-bold tracking-tight">Active Project</h1>
              <p className="mt-2 text-sm text-muted-foreground">This is how your Construct Lifecycle interface will look to users.</p>
              
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 flex justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</span>
                    <Badge tone="teal">In Progress</Badge>
                  </div>
                  <p className="text-xl font-bold">142 Days</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 flex justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Budget</span>
                    <Badge tone="orange">At Risk</Badge>
                  </div>
                  <p className="text-xl font-bold">$124,500</p>
                </div>
              </div>
              
              <div className="mt-6">
                <Button className="w-full">
                  <Check size={16} /> Complete Phase
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
