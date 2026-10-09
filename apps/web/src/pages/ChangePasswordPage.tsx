import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button, Card, Field, FormError, Input, PageHeader } from '../components/ui';
import { reloadPrincipal, useAuth } from '../features/auth/auth';
import { send, setAccessToken, type SessionData } from '../lib/api';
import { friendlyMessage } from '../lib/messages';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(10, 'Use at least 10 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'The two passwords do not match',
  });
type Values = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const forced = useAuth((s) => s.principal?.mustChangePassword) ?? false;
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      const r = await send<SessionData>('POST', '/auth/change-password', {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      });
      setAccessToken(r.data.accessToken); // every other device was signed out; this one continues with a fresh session
      await reloadPrincipal();
      toast.success('Password changed. Other devices have been signed out.');
      navigate('/', { replace: true });
    } catch (e) {
      setError(friendlyMessage(e));
    }
  });

  return (
    <div className={forced ? 'grid min-h-full place-items-center bg-bg px-4 py-10' : ''}>
      <div className="w-full max-w-md">
        <PageHeader
          title={forced ? 'Choose a new password' : 'Change password'}
          description={
            forced
              ? 'You are using a temporary password. Choose your own to continue.'
              : 'After changing it you will stay signed in here; other devices are signed out.'
          }
        />
        <Card className="p-5">
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <FormError message={error} />
            <Field
              label={forced ? 'Temporary password' : 'Current password'}
              error={errors.currentPassword?.message}
              required
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  {...register('currentPassword')}
                />
              )}
            </Field>
            <Field
              label="New password"
              hint="At least 10 characters, with three of: lower-case, upper-case, digits, symbols. Do not use your name or e-mail."
              error={errors.newPassword?.message}
              required
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  {...register('newPassword')}
                />
              )}
            </Field>
            <Field label="Repeat new password" error={errors.confirm?.message} required>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  {...register('confirm')}
                />
              )}
            </Field>
            <Button type="submit" loading={isSubmitting} className="w-full">
              Save new password
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
