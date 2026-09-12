import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowDown, ArrowUp, Check, GripVertical, Plus, RotateCcw, Save, Send, Workflow as WorkflowIcon } from 'lucide-react';
import {
  getGetWorkflowConfigQueryKey,
  useCreateWorkflowDraft,
  useGetWorkflowConfig,
  usePublishWorkflowDraft,
  useUpdateWorkflowDraft,
  type WorkflowConfigInput,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle } from '@/components/app-ui';

type StateDraft = WorkflowConfigInput['states'][number];
type StatusDraft = WorkflowConfigInput['statuses'][number];
type TransitionDraft = WorkflowConfigInput['transitions'][number];

const keyFromName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 63) || 'new_state';

export function WorkflowsAdmin() {
  const qc = useQueryClient();
  const query = useGetWorkflowConfig({ query: { queryKey: getGetWorkflowConfigQueryKey() } });
  const createDraft = useCreateWorkflowDraft();
  const updateDraft = useUpdateWorkflowDraft();
  const publishDraft = usePublishWorkflowDraft();
  const [states, setStates] = useState<StateDraft[]>([]);
  const [statuses, setStatuses] = useState<StatusDraft[]>([]);
  const [activeProjectStatusKeys, setActiveProjectStatusKeys] = useState<string[]>([]);
  const [transitions, setTransitions] = useState<TransitionDraft[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const activeConfig = query.data?.draft ?? query.data?.published;
  useEffect(() => {
    if (!activeConfig) return;
    setStates(activeConfig.states.map((state) => ({
      stableKey: state.stableKey,
      displayName: state.displayName,
      description: state.description,
      normalizedCategory: state.normalizedCategory,
      displayOrder: state.displayOrder,
      active: state.active,
      terminal: state.terminal,
      allowManualEnter: state.allowManualEnter,
      allowManualLeave: state.allowManualLeave,
      defaultStatusKey: state.defaultStatusKey,
      requiredFields: state.requiredFields,
    })));
    setStatuses(activeConfig.statuses.map((status) => ({
      stableKey: status.stableKey,
      displayName: status.displayName,
      stateKeys: status.stateKeys,
      displayOrder: status.displayOrder,
      active: status.active,
      required: status.required,
    })));
    setActiveProjectStatusKeys(activeConfig.template.activeProjectStatusKeys ?? ['active', 'waiting']);
    setTransitions(activeConfig.transitions.map((transition) => ({
      fromStateKey: transition.fromStateKey,
      toStateKey: transition.toStateKey,
      active: transition.active,
      requiresConfirmation: transition.requiresConfirmation,
      allowedRoles: transition.allowedRoles,
      requiredFields: transition.requiredFields,
      warningFields: transition.warningFields,
    })));
    setName(activeConfig.template.name);
    setDescription(activeConfig.template.description ?? '');
  }, [activeConfig]);

  if (query.isLoading) return <LoadingPanel lines={8} />;
  if (query.isError || !activeConfig) return <ErrorPanel onRetry={() => query.refetch()} />;

  const ensureDraft = (after: () => void) => {
    if (query.data?.draft) {
      after();
      return;
    }
    createDraft.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetWorkflowConfigQueryKey() });
        after();
      },
    });
  };

  const save = () => {
    setMessage(null);
    ensureDraft(() => updateDraft.mutate({
       data: { name, description: description || null, activeProjectStatusKeys, states, statuses, transitions },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetWorkflowConfigQueryKey() });
        setMessage('Draft saved. Publish it when the workflow is ready.');
      },
      onError: (error) => setMessage(error instanceof Error ? error.message : 'Draft could not be saved.'),
    }));
  };

  const publish = () => {
    setMessage(null);
    ensureDraft(() => publishDraft.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetWorkflowConfigQueryKey() });
        setMessage('Workflow published. New project views now use the updated lifecycle.');
      },
      onError: (error) => setMessage(error instanceof Error ? error.message : 'Workflow could not be published.'),
    }));
  };

  const addState = () => {
    const nextOrder = states.length;
    const displayName = 'New state';
    setStates((current) => [...current, {
      stableKey: `${keyFromName(displayName)}_${nextOrder + 1}`,
      displayName,
      description: null,
      normalizedCategory: 'EXECUTION',
      displayOrder: nextOrder,
      active: true,
      terminal: false,
      allowManualEnter: true,
      allowManualLeave: true,
      defaultStatusKey: null,
      requiredFields: [],
    }]);
  };
  const moveState = (index: number, direction: -1 | 1) => {
    setStates((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next.map((state, order) => ({ ...state, displayOrder: order }));
    });
  };
  const addTransition = () => {
    if (states.length < 2) return;
    const existing = new Set(transitions.map((transition) => `${transition.fromStateKey}:${transition.toStateKey}`));
    const candidate = states.slice(0, -1)
      .map((state, index) => ({ fromStateKey: state.stableKey, toStateKey: states[index + 1].stableKey }))
      .find((item) => !existing.has(`${item.fromStateKey}:${item.toStateKey}`));
    if (candidate) {
      setTransitions((current) => [...current, {
        ...candidate,
        active: true,
        requiresConfirmation: false,
        allowedRoles: ['owner', 'admin', 'member'],
        requiredFields: [],
        warningFields: [],
      }]);
    }
  };

  return (
    <div className="animate-rise">
      <PageTitle eyebrow="Settings / Administration / Project Configuration" title="Lifecycle & Workflows" description="Configure the labels, order, statuses, and published workflow used by this customer workspace." action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setStates(activeConfig.states.map((state) => ({ stableKey: state.stableKey, displayName: state.displayName, description: state.description, normalizedCategory: state.normalizedCategory, displayOrder: state.displayOrder, active: state.active, terminal: state.terminal, allowManualEnter: state.allowManualEnter, allowManualLeave: state.allowManualLeave, defaultStatusKey: state.defaultStatusKey, requiredFields: state.requiredFields }))); setStatuses(activeConfig.statuses.map((status) => ({ stableKey: status.stableKey, displayName: status.displayName, stateKeys: status.stateKeys, displayOrder: status.displayOrder, active: status.active, required: status.required }))); setActiveProjectStatusKeys(activeConfig.template.activeProjectStatusKeys ?? ['active', 'waiting']); setTransitions(activeConfig.transitions.map((transition) => ({ fromStateKey: transition.fromStateKey, toStateKey: transition.toStateKey, active: transition.active, requiresConfirmation: transition.requiresConfirmation, allowedRoles: transition.allowedRoles, requiredFields: transition.requiredFields, warningFields: transition.warningFields }))); }}> <RotateCcw size={14} /> Reset edits</Button><Button onClick={save} disabled={updateDraft.isPending || createDraft.isPending}><Save size={14} /> {updateDraft.isPending ? 'Saving…' : 'Save draft'}</Button><Button onClick={publish} disabled={publishDraft.isPending || createDraft.isPending}><Send size={14} /> {publishDraft.isPending ? 'Publishing…' : 'Publish workflow'}</Button></div>} />
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary"><WorkflowIcon size={17} /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-bold">{query.data?.draft ? `Draft v${query.data.draft.template.version}` : `Published v${query.data!.published.template.version}`}</p><p className="text-xs text-muted-foreground">{query.data?.draft ? 'Changes are isolated until you publish them.' : 'Create a draft to safely test lifecycle changes before publishing.'}</p></div>
        <Badge tone={query.data?.draft ? 'orange' : 'green'}>{query.data?.draft ? 'draft' : 'published'}</Badge>
      </div>
      {message && <div role="status" className="mb-5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{message}</div>}
      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-4"><div><h2 className="text-base font-bold">Lifecycle states</h2><p className="mt-1 text-xs text-muted-foreground">Stable keys stay unchanged when a customer renames a state.</p></div><Button variant="outline" onClick={addState}><Plus size={14} /> Add state</Button></div>
          <div className="space-y-3">
            {states.length === 0 && <EmptyState icon={WorkflowIcon} title="No lifecycle states" text="Add a state to begin configuring the workflow." />}
            {states.sort((a, b) => a.displayOrder - b.displayOrder).map((state, index) => <div key={`${state.stableKey}-${index}`} className={`rounded-lg border p-4 ${state.active === false ? 'border-dashed border-border/70 opacity-65' : 'border-border'}`}>
              <div className="flex items-start gap-3"><GripVertical size={16} className="mt-2 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="grid gap-3 md:grid-cols-[1fr_1fr]"><label className="block"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Display name</span><input value={state.displayName} onChange={(event) => setStates((current) => current.map((item) => item.stableKey === state.stableKey ? { ...item, displayName: event.target.value } : item))} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:ring-4 focus:ring-primary/20" /></label><label className="block"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Stable key</span><input value={state.stableKey} disabled className="mono w-full rounded-lg border border-input bg-secondary px-3 py-2 text-xs text-muted-foreground" /></label></div><div className="mt-3 flex flex-wrap gap-4 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={state.active !== false} onChange={(event) => setStates((current) => current.map((item) => item.stableKey === state.stableKey ? { ...item, active: event.target.checked } : item))} /> Active</label><label className="flex items-center gap-2"><input type="checkbox" checked={state.terminal === true} onChange={(event) => setStates((current) => current.map((item) => item.stableKey === state.stableKey ? { ...item, terminal: event.target.checked } : item))} /> Terminal</label><span className="mono text-muted-foreground">{state.normalizedCategory} · order {index + 1}</span></div></div><div className="flex shrink-0 items-center gap-1"><button type="button" aria-label={`Move ${state.displayName} up`} disabled={index === 0} className="rounded-md p-2 text-muted-foreground hover:bg-secondary disabled:opacity-30" onClick={() => moveState(index, -1)}><ArrowUp size={14} /></button><button type="button" aria-label={`Move ${state.displayName} down`} disabled={index === states.length - 1} className="rounded-md p-2 text-muted-foreground hover:bg-secondary disabled:opacity-30" onClick={() => moveState(index, 1)}><ArrowDown size={14} /></button><button type="button" aria-label={`Archive ${state.displayName}`} className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setStates((current) => current.map((item) => item.stableKey === state.stableKey ? { ...item, active: false } : item))}><Archive size={15} /></button></div></div>
            </div>)}
          </div>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 border-b border-border pb-4"><h2 className="text-base font-bold">Workflow identity</h2><p className="mt-1 text-xs text-muted-foreground">Draft and publish keeps production meaning stable.</p></div>
          <div className="space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Workflow name</span><input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:ring-4 focus:ring-primary/20" /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:ring-4 focus:ring-primary/20" /></label></div>
          <div className="mt-6 border-t border-border pt-5">
            <h3 className="text-sm font-bold">Statuses</h3>
            <p className="mt-1 text-xs text-muted-foreground">Status is separate from lifecycle state.</p>
            <div className="mt-3 space-y-2">
              {statuses.map((status) => (
                <div key={status.stableKey} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={activeProjectStatusKeys.includes(status.stableKey)}
                      onChange={(event) => setActiveProjectStatusKeys((current) => event.target.checked
                        ? [...current, status.stableKey]
                        : current.filter((key) => key !== status.stableKey))}
                      aria-label={`Include ${status.displayName} projects on Active Projects`}
                    />
                    Active Projects
                  </label>
                  <input
                    value={status.displayName}
                    aria-label={`Display name for ${status.stableKey} status`}
                    onChange={(event) => setStatuses((current) => current.map((item) => item.stableKey === status.stableKey ? { ...item, displayName: event.target.value } : item))}
                    className="min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold focus:border-input focus:bg-background"
                  />
                  <span className="mono text-[10px] text-muted-foreground">{status.stableKey}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Selected statuses are shown on the Active Projects page. Choose at least one.</p>
          </div>
          <div className="mt-6 border-t border-border pt-5">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-sm font-bold">Allowed transitions</h3><p className="mt-1 text-xs text-muted-foreground">Server-side rules control which roles can move projects between states.</p></div>
              <Button variant="outline" onClick={addTransition}><Plus size={14} /> Add</Button>
            </div>
            <div className="mt-3 space-y-3">
              {transitions.map((transition, index) => (
                <div key={`${transition.fromStateKey}-${transition.toStateKey}-${index}`} className="rounded-lg border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select aria-label="From state" value={transition.fromStateKey} onChange={(event) => setTransitions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, fromStateKey: event.target.value } : item))} className="rounded-md border border-input bg-background px-2 py-2 text-xs">{states.map((state) => <option key={state.stableKey} value={state.stableKey}>{state.displayName}</option>)}</select>
                    <select aria-label="To state" value={transition.toStateKey} onChange={(event) => setTransitions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, toStateKey: event.target.value } : item))} className="rounded-md border border-input bg-background px-2 py-2 text-xs">{states.map((state) => <option key={state.stableKey} value={state.stableKey}>{state.displayName}</option>)}</select>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input aria-label="Allowed roles" value={(transition.allowedRoles ?? []).join(', ')} onChange={(event) => setTransitions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, allowedRoles: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } : item))} placeholder="Allowed roles: owner, admin" className="rounded-md border border-input bg-background px-2 py-2 text-xs" />
                    <input aria-label="Required fields" value={(transition.requiredFields ?? []).join(', ')} onChange={(event) => setTransitions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, requiredFields: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } : item))} placeholder="Required fields: contractStart" className="rounded-md border border-input bg-background px-2 py-2 text-xs" />
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={transition.active !== false} onChange={(event) => setTransitions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} /> Active</label>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}