import { EmptyState, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="container page">
      <EmptyState title="Page not found" action={<LinkButton href="/" variant="primary">Back to the shop</LinkButton>}>
        The page you are looking for doesn&apos;t exist or has been removed.
      </EmptyState>
    </div>
  );
}
