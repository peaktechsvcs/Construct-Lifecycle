import { Badge } from '../../components/ui/badge';
import { Row } from '../parts';

export function BadgeDemo() {
  return (
    <div className="rounded-xl border bg-card p-6">
      <Row label="Variants">
        <Badge>Neutral</Badge>
        <Badge variant="primary">Primary</Badge>
        <Badge variant="info">Info</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="danger">Danger</Badge>
      </Row>
    </div>
  );
}
