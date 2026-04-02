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

export const ATSTableSkeleton: React.FC = () => {
  return (
    <div className="bg-background border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-foreground/5 border-b border-border">
            <TableHead className="w-[250px]"><Skeleton className="h-4 w-20 rounded-none" /></TableHead>
            <TableHead><Skeleton className="h-4 w-16 rounded-none" /></TableHead>
            <TableHead><Skeleton className="h-4 w-16 rounded-none" /></TableHead>
            <TableHead><Skeleton className="h-4 w-24 rounded-none" /></TableHead>
            <TableHead><Skeleton className="h-4 w-20 rounded-none" /></TableHead>
            <TableHead className="text-right"><Skeleton className="h-4 w-16 ml-auto rounded-none" /></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 10 }).map((_, i) => (
            <TableRow key={i} className="border-b border-border">
              <TableCell>
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-32 rounded-none" />
                  <Skeleton className="h-3 w-48 rounded-none" />
                </div>
              </TableCell>
              <TableCell><Skeleton className="h-5 w-20 rounded-none" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16 rounded-none" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24 rounded-none" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20 rounded-none" /></TableCell>
              <TableCell className="text-right">
                <div className="flex gap-1 justify-end">
                  <Skeleton className="h-7 w-7 rounded-none" />
                  <Skeleton className="h-7 w-7 rounded-none" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};