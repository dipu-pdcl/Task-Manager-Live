import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Upload, Search, Filter, FileText, Download, Pencil, Trash2, Eye, Tag, CalendarDays, User, FolderKanban, Users, Info, Clock, BarChart3, Share2, SortAsc, SortDesc, Grid, List, Folder, ChevronDown, Plus, SlidersHorizontal, RefreshCw, X } from 'lucide-react';
import { api, downloadExport } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { DocumentMeta, DocumentPermission, DocumentHistoryEntry, User as UserType, Project, Department, Team } from '../lib/types';
import { Modal, ConfirmModal, useToast, EmptyState, Skeleton, Badge, Avatar } from '../components/ui';
import { DocumentViewer } from '../components/DocumentViewer';
import { DocumentFolderSidebar, DocumentBreadcrumbs, type FolderNode } from '../components/DocumentFolderView';
import { cx, timeAgo, fmtDate } from '../lib/utils';

const ACCESS_OPTIONS = [
  { value: 'private', label: 'Private (only me)', desc: 'Only you can access' },
  { value: 'authenticated', label: 'Authenticated Users', desc: 'All logged-in users' },
  { value: 'public', label: 'Public', desc: 'Anyone with the link' },
  { value: 'team', label: 'Team', desc: 'Your team members' },
  { value: 'department', label: 'Department', desc: 'Your department members' },
];

const FILE_TYPE_LABELS: Record<string, { name: string; color: string }> = {
  pdf: { name: 'PDF', color: '#ef4444' },
  jpg: { name: 'Image', color: '#3b82f6' },
  jpeg: { name: 'Image', color: '#3b82f6' },
  png: { name: 'Image', color: '#3b82f6' },
  gif: { name: 'Image', color: '#3b82f6' },
  webp: { name: 'Image', color: '#3b82f6' },
  bmp: { name: 'Image', color: '#3b82f6' },
  svg: { name: 'Image', color: '#3b82f6' },
  doc: { name: 'Word', color: '#2563eb' },
  docx: { name: 'Word', color: '#2563eb' },
  xls: { name: 'Excel', color: '#10b981' },
  xlsx: { name: 'Excel', color: '#10b981' },
  csv: { name: 'CSV', color: '#059669' },
  txt: { name: 'Text', color: '#6b7280' },
  md: { name: 'Markdown', color: '#6b7280' },
  json: { name: 'JSON', color: '#6366f1' },
  log: { name: 'Log', color: '#6b7280' },
  other: { name: 'File', color: '#94a3b8' },
};

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
const isImageExt = (ft: string) => IMAGE_EXTS.includes(ft);
const isWordExt = (ft: string) => ft === 'doc' || ft === 'docx';
const isExcelExt = (ft: string) => ft === 'xls' || ft === 'xlsx' || ft === 'csv';
const isPreviewable = (ft: string) => isImageExt(ft) || ft === 'pdf' || ft === 'txt' || ft === 'md' || ft === 'json' || ft === 'csv';

export default function Documents() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [projects, setProjects] =
    useState<{ id: number; name: string }[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocumentMeta | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const [permOpen, setPermOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDoc, setHistoryDoc] = useState<DocumentMeta | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ file_type: '', project_id: '', team_id: '', department_id: '', user_id: '', access_permission: '', date_from: '', date_to: '' });
  const [uploadForm, setUploadForm] = useState({ file: null as File | null, filename: '', description: '', vendor_name: '', tags: '', version: '1.0', access_permission: 'public', project_id: '', team_id: '', department_id: '', folder_id: '' });
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<'delete' | null>(null);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParentId, setNewFolderParentId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size' | 'type'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isDragging, setIsDragging] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = search.trim();
      const params: Record<string, any> = { limit: '200' };
      if (q) params.q = q;
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      if (activeFolderId) params.folder_id = String(activeFolderId);
      const docs = await api.get<DocumentMeta[]>('/documents/search', params);
      setDocuments(docs);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [search, filters, activeFolderId, toast]);

  const loadFolders = useCallback(async () => {
    setFoldersLoading(true);
    try {
      const res = await api.get<{ tree: FolderNode[] }>('/documents/folders/tree');
      setFolders(res.tree || []);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setFoldersLoading(false); }
  }, [toast]);

  const loadDropdowns = useCallback(async () => {
    try {
      const [u, pData, d, t] = await Promise.all([
        api.get<UserType[]>('/users'),
        api.get<{ projects: Project[] }>('/projects'),
        api.get<Department[]>('/departments'),
        api.get<Team[]>('/teams'),
      ]);
      setUsers(u.filter((x) => x.is_active));
      setProjects((pData.projects || []).filter((x) => x.archived !== 1));
      setDepartments(d);
      setTeams(t);
    } catch (e: any) { toast(e.message, 'error'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDropdowns(); }, [loadDropdowns]);
  useEffect(() => { loadFolders(); }, [loadFolders]);

  const filtered = documents;

  const sortedAndFiltered = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortBy) {
        case 'name': aVal = a.filename.toLowerCase(); bVal = b.filename.toLowerCase(); break;
        case 'date': aVal = a.upload_date; bVal = b.upload_date; break;
        case 'size': aVal = a.size; bVal = b.size; break;
        case 'type': aVal = a.file_type || 'other'; bVal = b.file_type || 'other'; break;
        default: aVal = a.upload_date; bVal = b.upload_date;
      }
      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(bVal);
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      const numCmp = (aVal || 0) - (bVal || 0);
      return sortOrder === 'asc' ? numCmp : -numCmp;
    });
    return sorted;
  }, [filtered, sortBy, sortOrder]);

  const groupedByType = useMemo(() => {
    const groups: Record<string, DocumentMeta[]> = {};
    sortedAndFiltered.forEach((doc) => {
      const ft = doc.file_type || 'other';
      const key = FILE_TYPE_LABELS[ft]?.name || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(doc);
    });
    return groups;
  }, [sortedAndFiltered]);

  const openEditor = (doc?: DocumentMeta) => {
    setEditingDoc(doc || null);
    setEditOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (f) {
      setUploadForm((prev) => ({ ...prev, file: f }));
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0] || null;
    if (f) {
      setUploadForm((prev) => ({ ...prev, file: f }));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const openUploader = () => {
    setUploadForm({ file: null, filename: '', description: '', vendor_name: '', tags: '', version: '1.0', access_permission: 'public', project_id: '', team_id: '', department_id: '', folder_id: String(activeFolderId || '') });
    setUploadOpen(true);
  };

  const openNewFolder = (parent_id?: number | null) => {
    setNewFolderName('');
    setNewFolderParentId(parent_id ?? null);
    setNewFolderOpen(true);
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return toast('Folder name is required', 'error');
    try {
      await api.post('/documents/folders', { name: newFolderName.trim(), parent_id: newFolderParentId });
      toast('Folder created');
      setNewFolderOpen(false);
      loadFolders();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const renameFolder = async (folder: FolderNode) => {
    const newName = prompt('Enter new folder name:', folder.name);
    if (!newName) return;
    try {
      await api.put(`/documents/folders/${folder.id}`, { name: newName.trim() });
      toast('Folder renamed');
      loadFolders();
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const deleteFolder = async (folder: FolderNode) => {
    if (!confirm(`Delete "${folder.name}"? Non-empty folders cannot be deleted.`)) return;
    try {
      await api.delete(`/documents/folders/${folder.id}`);
      toast('Folder deleted');
      if (activeFolderId === folder.id) setActiveFolderId(null);
      loadFolders();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const upload = async () => {
    if (!uploadForm.file) return toast('Please select a file first', 'error');
    if (!uploadForm.filename.trim()) {
      setUploadForm((f) => ({ ...f, filename: uploadForm.file!.name.replace(/\.[^.]+$/, '') }));
    }

    const form = new FormData();
    form.append('file', uploadForm.file);
    form.append('filename', uploadForm.filename || uploadForm.file.name);
    form.append('description', uploadForm.description);
    form.append('vendor_name', uploadForm.vendor_name);
    form.append('tags', uploadForm.tags ? JSON.stringify(uploadForm.tags.split(',').map((t) => t.trim()).filter(Boolean)) : '[]');
    form.append('version', uploadForm.version);
    form.append('access_permission', uploadForm.access_permission);
    if (uploadForm.project_id) form.append('project_id', uploadForm.project_id);
    if (uploadForm.team_id) form.append('team_id', uploadForm.team_id);
    if (uploadForm.department_id) form.append('department_id', uploadForm.department_id);
    if (uploadForm.folder_id) form.append('folder_id', uploadForm.folder_id);

    setUploading(true);
    try {
      await api.upload<DocumentMeta>('/documents', form);
      toast('Document uploaded successfully');
      setUploadOpen(false);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setUploading(false); }
  };

  const updateDoc = async () => {
    if (!editingDoc) return;
    try {
      const tags = editingDoc.tags || [];
      await api.put<DocumentMeta>(`/documents/${editingDoc.id}`, {
        filename: editingDoc.filename,
        description: editingDoc.description,
        vendor_name: editingDoc.vendor_name,
        tags: tags,
        version: editingDoc.version,
        access_permission: editingDoc.access_permission,
        project_id: editingDoc.project_id || null,
        team_id: editingDoc.team_id || null,
        department_id: editingDoc.department_id || null,
        folder_id: editingDoc.folder_id || null,
      });
      toast('Document updated');
      setEditOpen(false);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const deleteDoc = (doc: DocumentMeta) => {
    if (!confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return;
    api.delete(`/documents/${doc.id}`).then(() => {
      toast('Document deleted');
      load();
    }).catch((e: any) => toast(e.message, 'error'));
  };

  const deleteSelected = async () => {
    const selectedDocs = documents.filter((d) => selected.has(d.id));
    if (selectedDocs.length === 0) return;
    if (!confirm(`Delete ${selectedDocs.length} document(s)? This cannot be undone.`)) return;
    try {
      for (const d of selectedDocs) {
        await api.delete(`/documents/${d.id}`);
      }
      toast(`${selectedDocs.length} documents deleted`);
      setSelected(new Set());
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const downloadDoc = (doc: DocumentMeta) => {
    downloadExport(`/documents/${doc.id}/download`, doc.filename);
  };

  const openViewer = (doc: DocumentMeta) => {
    const idx = documents.findIndex((d) => d.id === doc.id);
    setViewerInitialIndex(idx >= 0 ? idx : 0);
    setViewerOpen(true);
  };

  const openHistory = (doc: DocumentMeta) => {
    setHistoryDoc(doc);
    setHistoryOpen(true);
  };

  const openPermissions = (doc: DocumentMeta) => {
    setEditingDoc(doc);
    setPermOpen(true);
  };

  const toggleSelection = (docId: number) => {
    const next = new Set(selected);
    if (next.has(docId)) next.delete(docId);
    else next.add(docId);
    setSelected(next);
  };

  const fileTypeBadge = (ft: string) => {
    const info = FILE_TYPE_LABELS[ft] || FILE_TYPE_LABELS.other;
    return <Badge color={info.color} className="text-[10px]">{info.name}</Badge>;
  };

  const formatSize = (size: number) => {
    if (!size) return '—';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Document Management</h1>
          <p className="text-sm text-ink3 mt-0.5">Store, search, and manage documents with local file storage</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button onClick={() => openNewFolder(null)} className="btn btn-ghost btn-sm flex items-center gap-1">
              <Plus size={14} /> New Folder
            </button>
          )}
          <button onClick={openUploader} className="btn btn-primary flex items-center gap-2">
            <Upload size={16} /> Upload Document
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[140px] sm:min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Search by file name, type, project, tags..."
              className="input !pl-9 !py-2 w-full"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="input input-sm !w-auto"
          >
            <option value="date">Sort: Date</option>
            <option value="name">Sort: Name</option>
            <option value="size">Sort: Size</option>
            <option value="type">Sort: Type</option>
          </select>
          <button onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')} className="btn btn-ghost btn-sm" title="Toggle sort order">
            {sortOrder === 'asc' ? <SortAsc size={14} /> : <SortDesc size={14} />}
          </button>

          <button
            className={cx('btn btn-ghost btn-sm', (filters.file_type || filters.project_id || filters.access_permission || filters.date_from || filters.date_to) && '!text-brand !border-brand/40')}
            onClick={() => setFilterPanelOpen((o) => !o)}
          >
            <SlidersHorizontal size={14} /> Filters
          </button>
          {(filters.file_type || filters.project_id || filters.access_permission || filters.date_from || filters.date_to || search) && (
            <button onClick={() => { setFilters({ file_type: '', project_id: '', team_id: '', department_id: '', user_id: '', access_permission: '', date_from: '', date_to: '' }); setSearch(''); }} className="btn btn-ghost btn-sm">
              <X size={12} /> Clear All
            </button>
          )}
          {selected.size > 0 && (
            <button onClick={deleteSelected} className="btn btn-danger btn-sm flex items-center gap-1">
              <Trash2 size={14} /> Delete ({selected.size})
            </button>
          )}
          <button onClick={load} className="btn btn-ghost btn-sm" title="Apply filters">
            <RefreshCw size={14} />
          </button>
        </div>

        {filterPanelOpen && (
          <div className="card p-3 anim-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <label className="label text-xs text-ink3 mb-1">File Type</label>
                <select
                  value={filters.file_type}
                  onChange={(e) => setFilters({ ...filters, file_type: e.target.value })}
                  className="input input-sm"
                >
                  <option value="">All File Types</option>
                  {Object.entries(FILE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs text-ink3 mb-1">Project</label>
                <select
                  value={filters.project_id}
                  onChange={(e) => setFilters({ ...filters, project_id: e.target.value })}
                  className="input input-sm"
                >
                  <option value="">All Projects</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs text-ink3 mb-1">Access Permission</label>
                <select
                  value={filters.access_permission}
                  onChange={(e) => setFilters({ ...filters, access_permission: e.target.value })}
                  className="input input-sm"
                >
                  <option value="">All Permissions</option>
                  <option value="private">Private</option>
                  <option value="authenticated">Authenticated</option>
                  <option value="public">Public</option>
                </select>
              </div>
              <div>
                <label className="label text-xs text-ink3 mb-1">Date Range</label>
                <div className="flex gap-1">
                  <input
                    type="date"
                    value={filters.date_from}
                    onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
                    className="input input-sm"
                  />
                  <input
                    type="date"
                    value={filters.date_to}
                    onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
                    className="input input-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Content with Folder Sidebar */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        <DocumentFolderSidebar
          folders={folders}
          activeFolderId={activeFolderId}
          onSelectFolder={setActiveFolderId}
          onNewFolder={openNewFolder}
          onDeleteFolder={deleteFolder}
          onRenameFolder={renameFolder}
          loading={foldersLoading}
        />

        <div className="flex-1 overflow-y-auto">
          <div className="mb-4">
            <DocumentBreadcrumbs folders={folders} activeFolderId={activeFolderId} onSelectFolder={setActiveFolderId} />
          </div>

          {/* View Controls */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-ink3">{sortedAndFiltered.length} document{sortedAndFiltered.length !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="input input-sm text-xs">
                <option value="date">Date</option>
                <option value="name">Name</option>
                <option value="size">Size</option>
                <option value="type">Type</option>
              </select>
              <button onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')} className="btn btn-ghost btn-sm" title="Toggle sort order">
                {sortOrder === 'asc' ? <SortAsc size={14} /> : <SortDesc size={14} />}
              </button>
              <div className="flex gap-0.5 bg-card2 rounded-lg p-0.5">
                <button onClick={() => setViewMode('grid')} className={cx('p-1.5 rounded text-ink2', viewMode === 'grid' && 'bg-brand text-white')} title="Grid view">
                  <Grid size={14} />
                </button>
                <button onClick={() => setViewMode('list')} className={cx('p-1.5 rounded text-ink2', viewMode === 'list' && 'bg-brand text-white')} title="List view">
                  <List size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Document Groups */}
          <div className="space-y-6">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-5 w-48" />
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <Skeleton key={j} className="h-24 rounded-xl" />
                    ))}
                  </div>
                </div>
              ))
            ) : sortedAndFiltered.length === 0 ? (
              <EmptyState
                icon={<FileText size={24} />}
                title="No documents found"
                subtitle={search || Object.values(filters).some((v) => v) || activeFolderId ? "Try adjusting your search or filters" : "Upload your first document to get started"}
                action={<button onClick={openUploader} className="btn btn-primary flex items-center gap-2"><Upload size={14} /> Upload Document</button>}
              />
            ) : viewMode === 'grid' ? (
              Object.entries(groupedByType).map(([type, docs]) => (
                <div key={type} className="space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-ink2">{type} Documents</h3>
                    <span className="text-xs text-ink4 bg-card2 px-2 py-0.5 rounded-full">{docs.length}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {docs.map((doc) => (
                      <DocumentCard
                        key={doc.id}
                        doc={doc}
                        selected={selected.has(doc.id)}
                        onToggle={() => toggleSelection(doc.id)}
                        onPreview={() => openViewer(doc)}
                        onDownload={() => downloadDoc(doc)}
                        onEdit={() => openEditor(doc)}
                        onDelete={() => deleteDoc(doc)}
                        onPermissions={() => openPermissions(doc)}
                        onHistory={() => openHistory(doc)}
                        fileTypeBadge={fileTypeBadge}
                        formatSize={formatSize}
                        isAdmin={isAdmin}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="space-y-1">
                {sortedAndFiltered.map((doc) => (
                  <DocumentListItem
                    key={doc.id}
                    doc={doc}
                    selected={selected.has(doc.id)}
                    onToggle={() => toggleSelection(doc.id)}
                    onPreview={() => openViewer(doc)}
                    onDownload={() => downloadDoc(doc)}
                    onEdit={() => openEditor(doc)}
                    onDelete={() => deleteDoc(doc)}
                    onHistory={() => openHistory(doc)}
                    onPermissions={() => openPermissions(doc)}
                    fileTypeBadge={fileTypeBadge}
                    formatSize={formatSize}
                    isAdmin={isAdmin}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Folder Modal */}
      <Modal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        title="New Folder"
        width={400}
        footer={
          <div className="flex gap-2">
            <button onClick={() => setNewFolderOpen(false)} className="btn btn-ghost btn-sm">Cancel</button>
            <button onClick={createFolder} className="btn btn-primary btn-sm">Create</button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label text-sm font-medium">Folder Name *</label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="input w-full"
              placeholder="Enter folder name"
              onKeyDown={(e) => e.key === 'Enter' && createFolder()}
            />
          </div>
          <div>
            <label className="label text-sm font-medium">Parent Folder</label>
            <FolderSelect
              folders={folders}
              value={newFolderParentId ? String(newFolderParentId) : ''}
              onChange={(v) => setNewFolderParentId(v ? Number(v) : null)}
            />
          </div>
        </div>
      </Modal>

      {/* Upload Modal */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload Document"
        width={560}
        footer={
          <button onClick={upload} className="btn btn-primary" disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label text-sm font-medium">File *</label>
            <div
              className={cx(
                'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all',
                isDragging ? 'border-brand bg-brand/5' : 'border-line hover:border-brand/40',
                uploading && 'opacity-50 pointer-events-none',
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById('dms-file-input')?.click()}
            >
              <Upload size={24} className="mx-auto text-ink3 mb-2" />
              {uploadForm.file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText size={16} className="text-ink2" />
                  <span className="text-sm text-ink2 truncate max-w-[200px]" title={uploadForm.file.name}>{uploadForm.file.name}</span>
                  <span className="text-xs text-ink3">({(uploadForm.file.size / 1024).toFixed(1)} KB)</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setUploadForm((f) => ({ ...f, file: null })); }}
                    className="p-0.5 rounded hover:bg-bad/10 text-bad"
                    title="Remove file"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div>
                  <span className="text-sm text-ink2">Drag & drop a file here, or click to browse</span>
                  <p className="text-xs text-ink4 mt-1">PDF, Word, Excel, CSV, TXT, Markdown, JSON, Log, Images</p>
                </div>
              )}
              <input
                id="dms-file-input"
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.log,.png,.jpg,.jpeg,.gif,.webp"
                className="hidden"
                onChange={handleFileSelect}
                disabled={uploading}
              />
            </div>
          </div>
          <div>
            <label className="label text-sm font-medium">Display Name</label>
            <input type="text" value={uploadForm.filename} onChange={(e) => setUploadForm((f) => ({ ...f, filename: e.target.value }))} className="input w-full" placeholder="Defaults to file name" />
          </div>
          <div>
            <label className="label text-sm font-medium">Description</label>
            <textarea value={uploadForm.description} onChange={(e) => setUploadForm((f) => ({ ...f, description: e.target.value }))} className="input textarea w-full" rows={2} placeholder="Document description or notes" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label text-sm font-medium">Vendor Name</label>
              <input type="text" value={uploadForm.vendor_name} onChange={(e) => setUploadForm((f) => ({ ...f, vendor_name: e.target.value }))} className="input w-full" placeholder="Vendor or supplier" />
            </div>
            <div>
              <label className="label text-sm font-medium">Tags</label>
              <input type="text" value={uploadForm.tags} onChange={(e) => setUploadForm((f) => ({ ...f, tags: e.target.value }))} className="input w-full" placeholder="Comma-separated, e.g. finance, q1" />
            </div>
            <div>
              <label className="label text-sm font-medium">Version</label>
              <input type="text" value={uploadForm.version} onChange={(e) => setUploadForm((f) => ({ ...f, version: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="label text-sm font-medium">Access Permission</label>
              <select value={uploadForm.access_permission} onChange={(e) => setUploadForm((f) => ({ ...f, access_permission: e.target.value }))} className="input w-full">
                {ACCESS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label text-sm font-medium">Folder</label>
            <FolderSelect
              folders={folders}
              value={uploadForm.folder_id}
              onChange={(v) => setUploadForm((f) => ({ ...f, folder_id: v }))}
            />
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      {editingDoc && (
        <Modal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title="Edit Document"
          width={560}
          footer={<button onClick={updateDoc} className="btn btn-primary">Save Changes</button>}
        >
          <div className="space-y-4">
            <div>
              <label className="label text-sm font-medium">Display Name</label>
              <input type="text" value={editingDoc.filename} onChange={(e) => setEditingDoc({ ...editingDoc, filename: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="label text-sm font-medium">Description</label>
              <textarea value={editingDoc.description} onChange={(e) => setEditingDoc({ ...editingDoc, description: e.target.value })} className="input textarea w-full" rows={3} />
            </div>
            <div>
              <label className="label text-sm font-medium">Vendor Name</label>
              <input type="text" value={editingDoc.vendor_name || ''} onChange={(e) => setEditingDoc({ ...editingDoc, vendor_name: e.target.value })} className="input w-full" placeholder="Vendor or supplier name" />
            </div>
            <div>
              <label className="label text-sm font-medium">Tags (comma separated)</label>
              <input type="text" value={(editingDoc.tags || []).join(', ')} onChange={(e) => setEditingDoc({ ...editingDoc, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} className="input w-full" />
            </div>
            <div>
              <label className="label text-sm font-medium">Version</label>
              <input type="text" value={editingDoc.version} onChange={(e) => setEditingDoc({ ...editingDoc, version: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="label text-sm font-medium">Access Permission</label>
              <select value={editingDoc.access_permission} onChange={(e) => setEditingDoc({ ...editingDoc, access_permission: e.target.value as any })} className="input w-full">
                {ACCESS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-sm font-medium">Project</label>
              <select value={editingDoc.project_id || ''} onChange={(e) => setEditingDoc({ ...editingDoc, project_id: e.target.value ? Number(e.target.value) : null })} className="input w-full">
                <option value="">No Project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-sm font-medium">Team</label>
              <select value={editingDoc.team_id || ''} onChange={(e) => setEditingDoc({ ...editingDoc, team_id: e.target.value ? Number(e.target.value) : null })} className="input w-full">
                <option value="">No Team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-sm font-medium">Department</label>
              <select value={editingDoc.department_id || ''} onChange={(e) => setEditingDoc({ ...editingDoc, department_id: e.target.value ? Number(e.target.value) : null })} className="input w-full">
                <option value="">No Department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-sm font-medium">Folder</label>
              <FolderSelect
                folders={folders}
                value={editingDoc.folder_id ? String(editingDoc.folder_id) : ''}
                onChange={(v) => setEditingDoc({ ...editingDoc, folder_id: v ? Number(v) : null })}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Permissions Modal */}
      {editingDoc && (
        <DocumentPermissionsModal
          open={permOpen}
          onClose={() => setPermOpen(false)}
          doc={editingDoc}
          users={users}
          teams={teams}
          departments={departments}
          onUpdated={() => load()}
        />
      )}

      {/* History Modal */}
      {historyDoc && (
        <DocumentHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          doc={historyDoc}
        />
      )}

      {/* Document Viewer */}
      <DocumentViewer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        initialIndex={viewerInitialIndex}
        attachments={documents.map((d) => ({ id: d.id, filename: d.filename, stored_name: d.stored_name, mime: d.mime, size: d.size, file_path: d.file_path }))}
      />
    </div>
  );
}

interface DocumentPermissionsModalProps {
  open: boolean;
  onClose: () => void;
  doc: DocumentMeta;
  users: UserType[];
  teams: Team[];
  departments: Department[];
  onUpdated: () => void;
}

function DocumentPermissionsModal({ open, onClose, doc, users, teams, departments, onUpdated }: DocumentPermissionsModalProps) {
  const [perms, setPerms] = useState<DocumentPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [grantForm, setGrantForm] = useState({ target_type: 'user', target_id: '', permission: 'view' });
  const toast = useToast();

  const loadPerms = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ permissions: DocumentPermission[] }>(`/documents/${doc.id}/permissions`);
      setPerms(data.permissions);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [doc.id, toast]);

  useEffect(() => {
    if (open) loadPerms();
  }, [open, loadPerms]);

  const grant = async () => {
    if (!grantForm.target_id) return;
    const payload: any = { permission: grantForm.permission };
    if (grantForm.target_type === 'user') payload.user_id = Number(grantForm.target_id);
    else if (grantForm.target_type === 'team') payload.team_id = Number(grantForm.target_id);
    else payload.department_id = Number(grantForm.target_id);
    try {
      await api.post(`/documents/${doc.id}/permissions`, payload);
      toast('Permission granted');
      setGrantForm({ target_type: 'user', target_id: '', permission: 'view' });
      loadPerms();
      onUpdated();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const removePerm = async (permId: number) => {
    try {
      await api.delete(`/documents/${doc.id}/permissions/${permId}`);
      toast('Permission removed');
      loadPerms();
      onUpdated();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const targetOptions = grantForm.target_type === 'user' ? users :
    grantForm.target_type === 'team' ? teams : departments;

  return (
    <Modal open={open} onClose={onClose} title="Document Permissions" width={560}
      footer={<button onClick={grant} className="btn btn-primary">Grant</button>}
    >
      <div className="space-y-4">
        <div className="flex gap-2 items-end">
          <select value={grantForm.target_type} onChange={(e) => setGrantForm({ ...grantForm, target_type: e.target.value as any, target_id: '' })} className="input input-sm w-32">
            <option value="user">User</option>
            <option value="team">Team</option>
            <option value="department">Department</option>
          </select>
          <select value={grantForm.target_id} onChange={(e) => setGrantForm({ ...grantForm, target_id: e.target.value })} className="input input-sm flex-1">
            <option value="">Select...</option>
            {targetOptions.map((t: any) => <option key={t.id} value={t.id}>{t.name || t.department_name}</option>)}
          </select>
          <select value={grantForm.permission} onChange={(e) => setGrantForm({ ...grantForm, permission: e.target.value })} className="input input-sm w-24">
            <option value="view">View</option>
            <option value="download">Download</option>
            <option value="edit">Edit</option>
          </select>
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
          </div>
        ) : perms.length === 0 ? (
          <p className="text-sm text-ink3 text-center py-4">No additional permissions set</p>
        ) : (
          <div className="space-y-2">
            {perms.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-card2">
                <div className="flex items-center gap-2">
                  <Badge color="#6366f1">{p.permission}</Badge>
                  <span className="text-sm">{p.user_name || p.team_name || p.department_name}</span>
                </div>
                <button onClick={() => removePerm(p.id)} className="p-0.5 rounded hover:bg-bad/10 text-bad">
                  <span className="text-xs">Remove</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

interface DocumentHistoryModalProps {
  open: boolean;
  onClose: () => void;
  doc: DocumentMeta;
}

function DocumentHistoryModal({ open, onClose, doc }: DocumentHistoryModalProps) {
  const [history, setHistory] = useState<DocumentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ history: DocumentHistoryEntry[] }>(`/documents/${doc.id}/history`);
      setHistory(data.history);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [doc.id, toast]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Modal open={open} onClose={onClose} title="Document Activity" width={600}>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded" />)}
        </div>
      ) : history.length === 0 ? (
        <p className="text-sm text-ink3 py-4 text-center">No activity recorded</p>
      ) : (
        <div className="space-y-3">
          {history.map((h) => (
            <div key={h.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-card2">
              <Clock size={14} className="mt-0.5 text-ink3" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{h.action}</span>
                  {h.user_name && <span className="text-xs text-ink3">by {h.user_name}</span>}
                  <span className="text-xs text-ink3 ml-auto">{timeAgo(h.created_at)}</span>
                </div>
                {h.field && <span className="text-xs text-ink3">Field: {h.field}</span>}
                {(h.old_value || h.new_value) && (
                  <div className="text-xs text-ink3 mt-1">
                    {h.old_value && <span>Old: {h.old_value.slice(0, 100)}</span>}
                    {h.new_value && <span>New: {h.new_value.slice(0, 100)}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

interface DocumentCardProps {
  doc: DocumentMeta;
  selected: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPermissions: () => void;
  onHistory: () => void;
  fileTypeBadge: (ft: string) => React.ReactNode;
  formatSize: (size: number) => string;
  isAdmin: boolean;
}

function DocumentCard({ doc, selected, onToggle, onPreview, onDownload, onEdit, onDelete, onPermissions, onHistory, fileTypeBadge, formatSize, isAdmin }: DocumentCardProps) {
  const fileType = doc.file_type || 'other';
  const info = (FILE_TYPE_LABELS[fileType] || FILE_TYPE_LABELS.other);
  const canPreview = isPreviewable(fileType);

  return (
    <div className="card p-3 group transition-all hover:shadow-md">
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-0.5 shrink-0" />
        <div className="shrink-0">
          {isImageExt(fileType) ? (
            <img src={`/api/uploads/file/${doc.stored_name}`} alt={doc.filename} className="w-10 h-10 rounded object-cover" />
          ) : fileType === 'pdf' ? (
            <div className="w-10 h-10 rounded bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">📄</div>
          ) : isWordExt(fileType) ? (
            <div className="w-10 h-10 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">📝</div>
          ) : isExcelExt(fileType) ? (
            <div className="w-10 h-10 rounded bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400">📊</div>
          ) : (
            <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400">📎</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            {fileTypeBadge(fileType)}
          </div>
          <p className="font-medium text-sm truncate" title={doc.filename}>{doc.filename}</p>
          <p className="text-xs text-ink3 mt-0.5">v{doc.version} • {formatSize(doc.size)}</p>
          <div className="flex items-center gap-2 mt-1">
            {doc.uploader && <Avatar name={doc.uploader.name} src={doc.uploader.avatar} size={20} />}
            <span className="text-[10px] text-ink3">{doc.uploader?.name || 'Unknown'}</span>
            <span className="text-[10px] text-ink4">• {timeAgo(doc.upload_date)}</span>
          </div>
          {doc.tags && doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {doc.tags.slice(0, 2).map((t) => (
                <span key={t} className="text-[9px] px-1.5 py-0.25 rounded bg-brand/10 text-brand">{t}</span>
              ))}
              {doc.tags.length > 2 && <span className="text-[9px] text-ink4">+{doc.tags.length - 2} more</span>}
            </div>
          )}
        </div>
      </div>

       {canPreview && (
        <div className="mt-2 h-16 bg-card2/50 rounded overflow-hidden flex items-center justify-center">
          {fileType === 'pdf' ? (
            <embed src={`/api/uploads/file/${doc.stored_name}`} type="application/pdf" className="w-full h-16" />
          ) : isImageExt(fileType) ? (
            <img src={`/api/uploads/file/${doc.stored_name}`} alt={doc.filename} className="max-h-16 max-w-full object-contain" />
          ) : (
            <iframe src={`/api/uploads/file/${doc.stored_name}`} title={doc.filename} className="w-full h-16 border-none bg-card2/50 font-mono text-xs" />
          )}
        </div>
      )}

      <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1">
        <button onClick={onPreview} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Preview">
          <Eye size={14} />
        </button>
        <button onClick={onDownload} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Download">
          <Download size={14} />
        </button>
        <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Edit">
          <Pencil size={14} />
        </button>
        <button onClick={onHistory} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Activity">
          <Clock size={14} />
        </button>
        {isAdmin && (
          <button onClick={onPermissions} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Permissions">
            <Share2 size={14} />
          </button>
        )}
        {isAdmin && (
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-bad/10 text-bad" title="Delete">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function DocumentListItem({ doc, selected, onToggle, onPreview, onDownload, onEdit, onDelete, onHistory, onPermissions, fileTypeBadge, formatSize, isAdmin }: DocumentCardProps) {
  const fileType = doc.file_type || 'other';
  const info = (FILE_TYPE_LABELS[fileType] || FILE_TYPE_LABELS.other);

  return (
    <div className="card p-3 flex items-center gap-3 group transition-all hover:shadow-md">
      <input type="checkbox" checked={selected} onChange={onToggle} className="shrink-0" />
      <div className="shrink-0 w-10 h-10 flex items-center justify-center">
        {fileType === 'pdf' ? (
          <div className="w-10 h-10 rounded bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">📄</div>
        ) : isImageExt(fileType) ? (
          <img src={`/api/uploads/file/${doc.stored_name}`} alt={doc.filename} className="w-10 h-10 rounded object-cover" />
        ) : isWordExt(fileType) ? (
          <div className="w-10 h-10 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">📝</div>
        ) : isExcelExt(fileType) ? (
          <div className="w-10 h-10 rounded bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400">📊</div>
        ) : (
          <div className="w-10 h-10 rounded flex items-center justify-center" style={{ backgroundColor: info.color + '20', color: info.color }}>
            {info.name.charAt(0)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {fileTypeBadge(fileType)}
          <span className="font-medium text-sm truncate" title={doc.filename}>{doc.filename}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-ink3">
          <span>{formatSize(doc.size)}</span>
          <span>v{doc.version}</span>
          {doc.folder && <span className="flex items-center gap-1"><Folder size={10} />{doc.folder.name}</span>}
          <span>{timeAgo(doc.upload_date)}</span>
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        <button onClick={onPreview} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Preview"><Eye size={14} /></button>
        <button onClick={onDownload} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Download"><Download size={14} /></button>
        <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Edit"><Pencil size={14} /></button>
        <button onClick={onHistory} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Activity"><Clock size={14} /></button>
        {isAdmin && <button onClick={onPermissions} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Permissions"><Share2 size={14} /></button>}
        {isAdmin && <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-bad/10 text-bad" title="Delete"><Trash2 size={14} /></button>}
      </div>
    </div>
  );
}

function flattenFolders(folders: FolderNode[]): { id: number; name: string; parent_id: number | null; level: number }[] {
  const result: { id: number; name: string; parent_id: number | null; level: number }[] = [];
  const walk = (nodes: FolderNode[], level: number) => {
    nodes.forEach((f) => {
      result.push({ id: f.id, name: f.name, parent_id: f.parent_id, level });
      if (f.children) walk(f.children, level + 1);
    });
  };
  walk(folders, 0);
  return result;
}

function FolderSelect({ folders, value, onChange }: { folders: FolderNode[]; value: string; onChange: (v: string) => void }) {
  const flat = useMemo(() => flattenFolders(folders), [folders]);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input input-sm w-full"
    >
      <option value="">Root (All Documents)</option>
      {flat.map((f) => (
        <option key={f.id} value={String(f.id)} style={{ paddingLeft: `${f.level * 1.5 + 0.25}rem` }}>
          {'  '.repeat(f.level)}↳ {f.name}
        </option>
      ))}
    </select>
  );
}
