"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useElectronData } from "./use-electron-data";
import {
  BrowserModeState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./states";

export function AnchorsPage() {
  const { data, loading, error, unavailable, reload } = useElectronData((api) =>
    api.getAnchors()
  );
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const kw = keyword.trim().toLowerCase();
    if (!kw) return data;
    return data.filter(
      (a) =>
        a.name.toLowerCase().includes(kw) ||
        a.anchorName.toLowerCase().includes(kw) ||
        a.anchorId.includes(kw) ||
        a.douyinNo.includes(kw)
    );
  }, [data, keyword]);

  if (unavailable) {
    return (
      <Card>
        <CardContent>
          <BrowserModeState />
        </CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardContent>
          <LoadingState label="正在加载主播列表…" />
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent>
          <ErrorState message={error ?? "加载失败"} onRetry={reload} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索主播 / 抖音ID / 抖音号"
              className="pl-9"
            />
          </div>
          <Badge variant="secondary">
            共 {data.length} 人{keyword && ` · 匹配 ${filtered.length}`}
          </Badge>
        </div>

        {filtered.length === 0 ? (
          <EmptyState label="没有匹配的主播" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>主播</TableHead>
                <TableHead>性别</TableHead>
                <TableHead>抖音ID</TableHead>
                <TableHead>抖音号</TableHead>
                <TableHead className="text-right">账号数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a, i) => (
                <TableRow key={a.id}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium text-foreground">
                    {a.name}
                  </TableCell>
                  <TableCell>
                    <GenderBadge gender={a.gender} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {a.anchorId || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {a.douyinNo || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {a.accountCount > 1 ? (
                      <Badge variant="outline">{a.accountCount}</Badge>
                    ) : (
                      <span className="text-muted-foreground">{a.accountCount}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function GenderBadge({ gender }: { gender: string }) {
  if (gender === "male")
    return <Badge className="bg-chart-2/15 text-chart-2 hover:bg-chart-2/15">男</Badge>;
  if (gender === "female")
    return <Badge className="bg-chart-1/15 text-chart-1 hover:bg-chart-1/15">女</Badge>;
  return <Badge variant="outline">—</Badge>;
}
