import type { NodeGraphIn } from './schema';

/**
 * The mp4's picture (spec 2026-10-24 D: 「Access settings」): a public link reaches the customers bucket — one red,
 * glowing open path; read → Admin turns it into a grey dashed line and the badge into 「No open paths」. ui-smoke
 * draws the same graph (a JSON copy in scripts/ui-smoke.cjs — keep the two the same).
 */
export const ACCESS_SAMPLE = {
  title: 'Access settings',
  subtitle: 'Who can read the customers bucket',
  badge: { count: 'error', text: '{n} open path', okText: 'No open paths' },
  nodes: [
    { id: 'anyone', title: 'Anyone', subtitle: 'Public internet' },
    { id: 'admin', title: 'Admin', subtitle: '2 people' },
    { id: 'backup', title: 'Nightly backup', subtitle: 'paused' },
    {
      id: 'link', title: 'Share link', subtitle: 's3://acme-customers',
      rows: [
        { id: 'read', label: 'read', value: 'Anyone', options: [{ value: 'Anyone', marks: { 'e-open': 'error' } }, { value: 'Admin', marks: { 'e-open': 'dashed' } }] },
        { id: 'write', label: 'write', value: 'Admin', options: ['Admin', 'Team'] },
      ],
    },
    { id: 'bucket', title: 'customers', subtitle: 'S3 bucket', list: { title: '4 reads this week', items: [{ text: 'Lisbon', tags: ['PT', '2h'] }, { text: 'Austin', tags: ['US', '1d'] }, { text: 'Osaka', tags: ['JP', '3d'] }, { text: 'Berlin', tags: ['DE', '5d'] }] } },
  ],
  edges: [
    { id: 'e-open', from: 'anyone', to: 'link', label: 'public', style: 'error' },
    { id: 'e-admin', from: 'admin', to: 'link', label: 'member' },
    { id: 'e-read', from: 'link', to: 'bucket', fromRow: 'read', label: 'read' },
    { id: 'e-write', from: 'link', to: 'bucket', fromRow: 'write', label: 'write' },
    { id: 'e-backup', from: 'backup', to: 'bucket', label: 'paused', style: 'dashed' },
  ],
} satisfies NodeGraphIn;
