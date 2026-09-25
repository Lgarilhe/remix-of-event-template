import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** Les huit colonnes de `ATSTable`, aux mêmes largeurs. */
const HEADER_WIDTHS = ['w-16', 'w-10', 'w-12', 'w-10', 'w-16', 'w-24', 'w-10', 'w-0'];

export const ATSTableSkeleton: React.FC = () => {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" role="status" aria-label="Chargement du tableau">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {HEADER_WIDTHS.map((width, i) => (
              <TableHead key={i} className="h-10 px-3">
                {width !== 'w-0' && <Skeleton className={`h-3 ${width} rounded-sm`} />}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              <TableCell className="px-3 py-2.5">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-32 rounded-sm" />
                  <Skeleton className="h-3 w-44 rounded-sm" />
                </div>
              </TableCell>
              <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20 rounded-sm" /></TableCell>
              <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16 rounded-sm" /></TableCell>
              <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-32 rounded-sm" /></TableCell>
              <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-28 rounded-sm" /></TableCell>
              <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20 rounded-sm" /></TableCell>
              <TableCell className="px-3 py-2.5"><Skeleton className="h-5 w-8 rounded-full" /></TableCell>
              <TableCell className="px-3 py-2.5"><Skeleton className="h-7 w-7" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
