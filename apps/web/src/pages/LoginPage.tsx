import { zodResolver } from '@hookform/resolvers/zod';
import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button, Field, FormError, Input } from '../components/ui';
import { signIn, useAuth } from '../features/auth/auth';
import { friendlyMessage } from '../lib/messages';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your e-mail').email('Enter a valid e-mail'),
  password: z.string().min(1, 'Enter your password'),
});
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [error, setError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (status === 'authed') return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      await signIn(v.email, v.password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(friendlyMessage(e));
    }
  });

  return (
    <div className="grid min-h-full place-items-center bg-bg px-4 py-10">
      <div className="page-enter w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-on-primary">
            <GraduationCap className="size-7" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-ink">School Fees</h1>
            <p className="mt-1 text-sm text-muted">
              Sign in to manage fees, students and collections.
            </p>
          </div>
        </div>
        <form
          onSubmit={onSubmit}
          noValidate
          className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-[var(--shadow-e2)]"
        >
          <FormError message={error} />
          <Field label="E-mail" error={errors.email?.message} required>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="username"
                autoFocus
                placeholder="you@school.in"
                {...register('email')}
              />
            )}
          </Field>
          <Field label="Password" error={errors.password?.message} required>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                {...register('password')}
              />
            )}
          </Field>
          <Button type="submit" loading={isSubmitting} className="w-full">
            Sign in
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-muted">
          Forgot your password? Ask your administrator to reset it.
        </p>
      </div>
    </div>
  );
}
