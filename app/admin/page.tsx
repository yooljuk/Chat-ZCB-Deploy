'use client';

import { useState, useEffect } from 'react';

type Log = {
  timestamp: string;
  type: 'certification' | 'consulting';
  question: string;
  answer: string;
  isFallback: boolean;
};

type Stats = {
  totalQuestions: number;
  fallbackCount: number;
  fallbackRate: number;
  byType: {
    certification: number;
    consulting: number;
  };
};

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [sessionPassword, setSessionPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [activeTab, setActiveTab] = useState<'logs' | 'stats'>('logs');

  // 로그 관련 상태
  const [logs, setLogs] = useState<Log[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [fallbackOnly, setFallbackOnly] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // 통계 관련 상태
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // 비밀번호 인증
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSessionPassword(password);
        setIsAuthenticated(true);
        setPassword('');
      } else {
        setAuthError('비밀번호가 올바르지 않습니다.');
      }
    } catch (error) {
      setAuthError('인증 중 오류가 발생했습니다.');
    }
  };

  // 로그 불러오기
  const fetchLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.append('type', typeFilter);
      if (dateFrom) params.append('from', dateFrom);
      if (dateTo) params.append('to', dateTo);
      if (fallbackOnly) params.append('fallback', 'true');

      const response = await fetch(`/api/logs?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        setLogs(data.logs || []);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  // 통계 불러오기
  const fetchStats = async () => {
    setIsLoadingStats(true);
    try {
      const response = await fetch('/api/stats');
      const data = await response.json();

      if (response.ok) {
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  // 탭 변경 시 데이터 로드
  useEffect(() => {
    if (isAuthenticated) {
      if (activeTab === 'logs') {
        fetchLogs();
      } else {
        fetchStats();
      }
    }
  }, [isAuthenticated, activeTab]);

  // 필터 변경 시 로그 다시 불러오기
  useEffect(() => {
    if (isAuthenticated && activeTab === 'logs') {
      fetchLogs();
    }
  }, [typeFilter, dateFrom, dateTo, fallbackOnly]);

  const handleLogout = () => {
    setIsAuthenticated(false);
    setPassword('');
    setSessionPassword('');
    setLogs([]);
    setStats(null);
  };

  // 로그 삭제
  const handleDeleteLogs = async (mode: 'all' | 'before') => {
    let confirmMsg = '전체 로그를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.';
    let before: string | undefined;

    if (mode === 'before') {
      const input = prompt('삭제할 기준 날짜를 입력하세요 (예: 2025-01-01)\n해당 날짜 이전의 로그가 모두 삭제됩니다.');
      if (!input) return;
      // 간단한 날짜 형식 검증
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        alert('날짜 형식이 올바르지 않습니다. (예: 2025-01-01)');
        return;
      }
      before = input;
      confirmMsg = `${input} 이전의 로그를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`;
    }

    if (!confirm(confirmMsg)) return;

    try {
      const response = await fetch('/api/logs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: sessionPassword,
          before,
        }),
      });
      const data = await response.json();

      if (response.ok && data.success) {
        alert(data.message);
        fetchLogs();
        if (activeTab === 'stats') fetchStats();
      } else {
        alert(data.error || '삭제에 실패했습니다.');
      }
    } catch (error) {
      console.error('로그 삭제 실패:', error);
      alert('로그 삭제 중 오류가 발생했습니다.');
    }
  };

  // Excel 다운로드
  const handleExcelDownload = async () => {
    try {
      // 전체 로그 조회 (필터 없이)
      const response = await fetch('/api/logs');
      const data = await response.json();
      const allLogs: Log[] = data.logs || [];

      if (allLogs.length === 0) {
        alert('다운로드할 로그가 없습니다.');
        return;
      }

      // xlsx를 동적 import (클라이언트 사이드)
      const XLSX = await import('xlsx');

      const rows = allLogs.map((log, i) => ({
        '번호': i + 1,
        '날짜/시간': new Date(log.timestamp).toLocaleString('ko-KR'),
        '기관 유형': log.type === 'certification' ? '인증기관' : '컨설팅기관',
        '질문': log.question,
        '응답': log.answer,
        '폴백 여부': log.isFallback ? 'O' : '-',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);

      // 열 너비 설정
      ws['!cols'] = [
        { wch: 6 },   // 번호
        { wch: 20 },  // 날짜/시간
        { wch: 12 },  // 기관 유형
        { wch: 40 },  // 질문
        { wch: 60 },  // 응답
        { wch: 10 },  // 폴백 여부
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '대화 로그');

      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `Chat-ZCB_로그_${today}.xlsx`);
    } catch (error) {
      console.error('Excel 다운로드 실패:', error);
      alert('Excel 다운로드 중 오류가 발생했습니다.');
    }
  };

  // 인증 화면
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-2xl font-bold text-[#2E7D32] mb-6 text-center">
            관리자 로그인
          </h1>
          <form onSubmit={handleAuth}>
            <div className="mb-4">
              <label htmlFor="password" className="block text-sm font-medium text-[#333] mb-2">
                비밀번호
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2E7D32]"
                placeholder="비밀번호를 입력하세요"
              />
            </div>
            {authError && (
              <p className="text-red-600 text-sm mb-4">{authError}</p>
            )}
            <button
              type="submit"
              className="w-full bg-[#2E7D32] text-white py-2 rounded-lg font-semibold hover:bg-[#1B5E20] transition-colors"
            >
              로그인
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 대시보드 화면
  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      {/* 헤더 */}
      <header className="bg-[#2E7D32] text-white px-6 py-4 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold">Chat-ZCB 관리자 페이지</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExcelDownload}
              className="text-sm bg-white text-[#2E7D32] px-4 py-2 rounded font-semibold hover:bg-[#E8F5E9] transition-colors"
            >
              Excel 다운로드
            </button>
            <button
              onClick={() => handleDeleteLogs('before')}
              className="text-sm bg-yellow-500 text-white px-4 py-2 rounded font-semibold hover:bg-yellow-600 transition-colors"
            >
              기간별 삭제
            </button>
            <button
              onClick={() => handleDeleteLogs('all')}
              className="text-sm bg-red-600 text-white px-4 py-2 rounded font-semibold hover:bg-red-700 transition-colors"
            >
              전체 삭제
            </button>
            <button
              onClick={handleLogout}
              className="text-sm bg-[#1B5E20] px-4 py-2 rounded hover:bg-[#145018] transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 탭 */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'logs'
                ? 'bg-[#2E7D32] text-white'
                : 'bg-white text-[#333] hover:bg-[#E8F5E9]'
            }`}
          >
            대화 로그
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'stats'
                ? 'bg-[#2E7D32] text-white'
                : 'bg-white text-[#333] hover:bg-[#E8F5E9]'
            }`}
          >
            통계
          </button>
        </div>

        {/* 대화 로그 탭 */}
        {activeTab === 'logs' && (
          <div>
            {/* 필터 */}
            <div className="bg-white p-4 rounded-lg shadow-sm mb-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#333] mb-1">
                    기관 유형
                  </label>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2E7D32]"
                  >
                    <option value="all">전체</option>
                    <option value="certification">인증기관</option>
                    <option value="consulting">컨설팅기관</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#333] mb-1">
                    시작 날짜
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2E7D32]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#333] mb-1">
                    종료 날짜
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2E7D32]"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fallbackOnly}
                      onChange={(e) => setFallbackOnly(e.target.checked)}
                      className="w-4 h-4 text-[#2E7D32] border-[#E0E0E0] rounded focus:ring-[#2E7D32]"
                    />
                    <span className="ml-2 text-sm text-[#333]">폴백 발생만</span>
                  </label>
                </div>
              </div>
            </div>

            {/* 로그 목록 */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              {isLoadingLogs ? (
                <div className="p-8 text-center text-[#666]">로딩 중...</div>
              ) : logs.length === 0 ? (
                <div className="p-8 text-center text-[#666]">로그가 없습니다.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-[#F5F5F5]">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-[#333]">날짜/시간</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-[#333]">기관 유형</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-[#333]">질문</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-[#333]">응답</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-[#333]">폴백</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E0E0E0]">
                      {logs.map((log, index) => (
                        <tr key={index} className="hover:bg-[#F5F5F5]">
                          <td className="px-4 py-3 text-sm text-[#333] whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString('ko-KR')}
                          </td>
                          <td className="px-4 py-3 text-sm text-[#333]">
                            {log.type === 'certification' ? '인증기관' : '컨설팅기관'}
                          </td>
                          <td className="px-4 py-3 text-sm text-[#333] max-w-xs truncate">
                            {log.question}
                          </td>
                          <td className="px-4 py-3 text-sm text-[#333] max-w-md truncate">
                            {log.answer}
                          </td>
                          <td className="px-4 py-3 text-sm text-center">
                            {log.isFallback ? (
                              <span className="text-red-600 font-semibold">O</span>
                            ) : (
                              <span className="text-[#999]">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 통계 탭 */}
        {activeTab === 'stats' && (
          <div>
            {isLoadingStats ? (
              <div className="bg-white p-8 rounded-lg shadow-sm text-center text-[#666]">
                로딩 중...
              </div>
            ) : stats ? (
              <div className="space-y-6">
                {/* 통계 카드 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-sm font-medium text-[#666] mb-2">총 질문 수</h3>
                    <p className="text-3xl font-bold text-[#2E7D32]">{stats.totalQuestions}</p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-sm font-medium text-[#666] mb-2">폴백 발생</h3>
                    <p className="text-3xl font-bold text-red-600">{stats.fallbackCount}</p>
                    <p className="text-sm text-[#666] mt-1">
                      ({stats.fallbackRate.toFixed(1)}%)
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-sm font-medium text-[#666] mb-2">응답 성공률</h3>
                    <p className="text-3xl font-bold text-[#2E7D32]">
                      {(100 - stats.fallbackRate).toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* 기관별 질문 수 차트 */}
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-lg font-semibold text-[#333] mb-4">기관별 질문 수</h3>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm text-[#333]">인증기관</span>
                        <span className="text-sm font-semibold text-[#333]">{stats.byType.certification}</span>
                      </div>
                      <div className="w-full bg-[#E0E0E0] rounded-full h-4">
                        <div
                          className="bg-[#2E7D32] h-4 rounded-full transition-all"
                          style={{
                            width: `${stats.totalQuestions > 0 ? (stats.byType.certification / stats.totalQuestions) * 100 : 0}%`
                          }}
                        ></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm text-[#333]">컨설팅기관</span>
                        <span className="text-sm font-semibold text-[#333]">{stats.byType.consulting}</span>
                      </div>
                      <div className="w-full bg-[#E0E0E0] rounded-full h-4">
                        <div
                          className="bg-[#4CAF50] h-4 rounded-full transition-all"
                          style={{
                            width: `${stats.totalQuestions > 0 ? (stats.byType.consulting / stats.totalQuestions) * 100 : 0}%`
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white p-8 rounded-lg shadow-sm text-center text-[#666]">
                통계 데이터가 없습니다.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
