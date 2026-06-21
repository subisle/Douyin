"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Users, Waves, Clock, Search } from "lucide-react";
import { useElectronData } from "./use-electron-data";
import { formatWave, formatDuration, formatNumber } from "./format";
import type { FamilyNode } from "@/types/electron";
import { LoadingState, ErrorState, EmptyState } from "./states";

type FlowingFlagData = {
  master: { id: number; name: string } | null;
  members: {
    id: number;
    name: string;
    gender: string;
    anchorId: string;
    wave: number;
    duration: number;
  }[];
  avgWave: number;
  avgDuration: number;
  count: number;
};

export function FlowingFlagCard() {
  const treeRes = useElectronData((api) => api.getFamilyTree());
  const [selectedMasterId, setSelectedMasterId] = useState<number | null>(null);
  const [flagData, setFlagData] = useState<FlowingFlagData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 找出有徒弟的人（被别人当 masterId 的人）
  const masters = useMemo(() => {
    if (!treeRes.data) return [];
    const masterIds = new Set<number>();
    for (const node of treeRes.data) {
      if (node.masterId) masterIds.add(node.masterId);
    }
    // 返回有徒弟的师傅，带徒弟数量
    return treeRes.data
      .filter((n) => masterIds.has(n.id) && n.gender === "male")
      .map((n) => {
        const apprenticeCount = treeRes.data!.filter(
          (a) => a.masterId === n.id
        ).length;
        return { ...n, apprenticeCount };
      })
      .sort((a, b) => b.apprenticeCount - a.apprenticeCount);
  }, [treeRes.data]);

  // 默认选第一个师傅
  useEffect(() => {
    if (masters.length > 0 && selectedMasterId === null) {
      setSelectedMasterId(masters[0].id);
    }
  }, [masters, selectedMasterId]);

  const fetchFlag = useCallback(async (personId: number) => {
    const api = window.electronAPI;
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getFlowingFlag(personId);
      if (res.success) {
        setFlagData(res.data);
      } else {
        setError(res.error || "加载失败");
        setFlagData(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFlagData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedMasterId !== null) {
      fetchFlag(selectedMasterId);
    }
  }, [selectedMasterId, fetchFlag]);

  const selectedMaster = useMemo(() => {
    if (!masters || selectedMasterId === null) return null;
    return masters.find((m) => m.id === selectedMasterId) || null;
  }, [masters, selectedMasterId]);

  const filteredMasters = useMemo(() => {
    if (!searchQuery.trim()) return masters;
    const q = searchQuery.trim().toLowerCase();
    return masters.filter((m) => m.name.toLowerCase().includes(q));
  }, [masters, searchQuery]);

  const onSelectMaster = (master: FamilyNode & { apprenticeCount: number }) => {
    setSelectedMasterId(master.id);
    setDropdownOpen(false);
    setSearchQuery("");
  };

  if (treeRes.loading) {
    return (
      <Card>
        <CardContent>
          <LoadingState label="加载族谱数据…" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">🚩 流动红旗</CardTitle>
            {selectedMaster && (
              <Badge variant="secondary">
                {selectedMaster.name} + {selectedMaster.apprenticeCount} 徒弟
              </Badge>
            )}
          </div>
          {/* 师傅选择下拉 */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="app-no-drag flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              <span className="max-w-[160px] truncate">
                {selectedMaster ? selectedMaster.name : "选择师傅"}
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </button>
            {dropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => {
                    setDropdownOpen(false);
                    setSearchQuery("");
                  }}
                />
                <div className="app-no-drag absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-border bg-popover shadow-2xl">
                  <div className="border-b border-border p-2">
                    <div className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5">
                      <Search className="size-4 text-muted-foreground" />
                      <input
                        autoFocus
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索师傅名…"
                        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>
                  <div className="max-h-60 overflow-auto p-1">
                    {filteredMasters.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => onSelectMaster(m)}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-accent ${
                          m.id === selectedMasterId
                            ? "bg-accent/50 font-medium"
                            : ""
                        }`}
                      >
                        <span className="truncate">{m.name}</span>
                        <Badge variant="outline" className="ml-2 shrink-0">
                          {m.apprenticeCount} 徒弟
                        </Badge>
                      </button>
                    ))}
                    {filteredMasters.length === 0 && (
                      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                        未找到匹配师傅
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState label="加载流动红旗数据…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => selectedMasterId !== null && fetchFlag(selectedMasterId)} />
        ) : !flagData || flagData.count === 0 ? (
          <EmptyState label="暂无数据" />
        ) : (
          <div className="space-y-4">
            {/* 平均值卡片 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    总人数
                  </span>
                  <Users className="size-4 text-muted-foreground" />
                </div>
                <p className="mt-1 text-xl font-bold text-foreground">
                  {flagData.count}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    平均音浪
                  </span>
                  <Waves className="size-4 text-primary" />
                </div>
                <p className="mt-1 text-xl font-bold text-primary">
                  {formatWave(flagData.avgWave)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    平均时长
                  </span>
                  <Clock className="size-4 text-chart-2" />
                </div>
                <p className="mt-1 text-xl font-bold text-chart-2">
                  {formatDuration(flagData.avgDuration)}
                </p>
              </div>
            </div>

            {/* 成员明细表 */}
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      #
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      姓名
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      身份
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                      音浪
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                      时长
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {flagData.members.map((m, i) => {
                    const isMaster = m.id === flagData.master?.id;
                    return (
                      <tr
                        key={m.id}
                        className="border-t border-border hover:bg-muted/30"
                      >
                        <td className="px-4 py-2 text-muted-foreground">
                          {i + 1}
                        </td>
                        <td className="px-4 py-2 font-medium">
                          {m.name}
                          {m.gender === "male" ? (
                            <Badge className="bg-chart-2/15 text-chart-2 hover:bg-chart-2/15 ml-2">
                              男
                            </Badge>
                          ) : m.gender === "female" ? (
                            <Badge className="bg-chart-1/15 text-chart-1 hover:bg-chart-1/15 ml-2">
                              女
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            variant={isMaster ? "default" : "secondary"}
                          >
                            {isMaster ? "师傅" : "徒弟"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatWave(m.wave)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatDuration(m.duration)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/50">
                  <tr className="border-t border-border font-medium">
                    <td className="px-4 py-2" colSpan={3}>
                      平均值
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-primary">
                      {formatWave(flagData.avgWave)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-chart-2">
                      {formatDuration(flagData.avgDuration)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
