import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../components/ui';

export default function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you are looking for does not exist or has moved."
      action={
        <Link to="/">
          <Button>Go to the dashboard</Button>
        </Link>
      }
    />
  );
}
