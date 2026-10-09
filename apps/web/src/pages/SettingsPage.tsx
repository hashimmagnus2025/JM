import { Pencil, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Modal } from '../components/overlay';
import { QueryBoundary } from '../components/QueryBoundary';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  FormError,
  Input,
  PageHeader,
  Field,
} from '../components/ui';
import { useCan } from '../features/auth/auth';
import {
  useResetSetting,
  useSettings,
  useUpdateSetting,
  type SettingView,
} from '../features/setup/api';
import { SettingEditor, summarize } from '../features/setup/settingEditors';
import { friendlyMessage } from '../lib/messages';

function EditModal({ setting, onClose }: { setting: SettingView; onClose: () => void }) {
  const update = useUpdateSetting();
  const [value, setValue] = useState<unknown>(setting.value);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await update.mutateAsync({
        key: setting.key,
        value,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success(`${setting.label} updated`);
      onClose();
    } catch (e) {
      setError(friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={setting.label}
      description={setting.description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!invalid} loading={busy} onClick={save}>
            Save setting
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error ?? invalid ?? undefined} />
        <SettingEditor
          settingKey={setting.key}
          value={setting.value}
          onChange={setValue}
          onValidity={setInvalid}
        />
        <Field
          label="Reason (optional)"
          hint="Kept in the audit history together with the old and new value."
        >
          {(p) => (
            <Input
              {...p}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Parents asked for earlier reminders"
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

export default function SettingsPage() {
  const query = useSettings();
  const reset = useResetSetting();
  const can = useCan();
  const canEdit = can('settings.manage');
  const [editing, setEditing] = useState<SettingView | null>(null);
  const [resetting, setResetting] = useState<SettingView | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, SettingView[]>();
    for (const s of query.data ?? []) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()];
  }, [query.data]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="School rules that change how fees are calculated and collected. Every change is recorded with the old and new value."
      />
      <QueryBoundary query={query}>
        {() => (
          <div className="space-y-6">
            {groups.map(([group, items]) => (
              <Card key={group}>
                <CardHeader title={group} />
                <ul className="divide-y divide-line">
                  {items.map((s) => (
                    <li
                      key={s.key}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                    >
                      <div className="min-w-0 flex-1 basis-72">
                        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                          {s.label}
                          {s.rule && <Badge tone="info">{s.rule}</Badge>}
                          {!s.isDefault && <Badge tone="warning">Changed</Badge>}
                        </p>
                        <p className="mt-0.5 text-[13px] text-muted">{s.description}</p>
                        <p className="mt-1.5 text-sm text-ink">
                          <span className="text-muted">Now: </span>
                          <strong>{summarize(s.key, s.value)}</strong>
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-2">
                          {!s.isDefault && (
                            <Button variant="ghost" size="sm" onClick={() => setResetting(s)}>
                              <RotateCcw className="size-4" aria-hidden /> Use default
                            </Button>
                          )}
                          <Button variant="secondary" size="sm" onClick={() => setEditing(s)}>
                            <Pencil className="size-4" aria-hidden /> Change
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>

      {editing && <EditModal setting={editing} onClose={() => setEditing(null)} />}
      {resetting && (
        <Modal
          open
          onClose={() => setResetting(null)}
          title={`Use the default for "${resetting.label}"?`}
          description={`It will go back to: ${summarize(resetting.key, resetting.default)}.`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetting(null)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  const s = resetting;
                  setResetting(null);
                  try {
                    await reset.mutateAsync(s.key);
                    toast.success(`${s.label} is back to the default`);
                  } catch (e) {
                    toast.error(friendlyMessage(e));
                  }
                }}
              >
                Use default
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            Currently: {summarize(resetting.key, resetting.value)}
          </p>
        </Modal>
      )}
    </>
  );
}
