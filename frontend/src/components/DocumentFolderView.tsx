import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Plus, Trash2, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { cx } from '../lib/utils';
import type { DocumentMeta } from '../lib/types';

export interface FolderNode {
  id: number;
  name: string;
  parent_id: number | null;
  path: string;
  created_by: number;
  children: FolderNode[];
  document_count?: number;
}

interface DocumentFolderSidebarProps {
  folders: FolderNode[];
  activeFolderId: number | null;
  onSelectFolder: (folderId: number | null) => void;
  onNewFolder: (parent_id?: number | null) => void;
  onDeleteFolder: (folder: FolderNode) => void;
  onRenameFolder: (folder: FolderNode) => void;
  loading?: boolean;
}

export function DocumentFolderSidebar({
  folders,
  activeFolderId,
  onSelectFolder,
  onNewFolder,
  onDeleteFolder,
  onRenameFolder,
  loading,
}: DocumentFolderSidebarProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderTree = (nodes: FolderNode[], level = 0) => {
    return nodes.map((f) => {
      const isExpanded = expanded.has(f.id);
      const hasChildren = f.children && f.children.length > 0;
      const isActive = activeFolderId === f.id;
      return (
        <div key={f.id} style={{ paddingLeft: `${level * 16 + 8}px` }} className="py-0.5">
          <div
            className={cx(
              'flex items-center gap-1.5 py-1.5 rounded-lg text-sm transition-all cursor-pointer group',
              isActive ? 'bg-brand/15 text-brand' : 'text-ink2 hover:bg-card2 hover:text-ink',
            )}
            onClick={() => {
              onSelectFolder(f.id);
              if (hasChildren) toggleExpand(f.id);
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleExpand(f.id);
                else toggleExpand(f.id);
              }}
              className="p-0.25 rounded hover:bg-card2 text-ink3"
            >
              {hasChildren && (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
              {(!hasChildren || !isExpanded) && <ChevronRight size={12} className="invisible w-3" />}
            </button>
            {isExpanded || !hasChildren ? <FolderOpen size={14} /> : <Folder size={14} />}
            <span className="truncate flex-1">{f.name}</span>
            {f.document_count !== undefined && f.document_count > 0 && (
              <span className="text-[10px] bg-card px-1.5 py-0.25 rounded-full text-ink3">{f.document_count}</span>
            )}
            <div className="opacity-0 group-hover:opacity-100 flex gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); onRenameFolder(f); }}
                className="p-0.25 rounded hover:bg-card2 text-ink3"
                title="Rename"
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteFolder(f); }}
                className="p-0.25 rounded hover:bg-bad/10 text-bad"
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
          {hasChildren && isExpanded && (
            <div>{renderTree(f.children, level + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="w-64 shrink-0 border-r border-line overflow-y-auto bg-card flex flex-col">
      <div className="p-3 border-b border-line flex items-center justify-between">
        <h3 className="font-semibold text-sm text-ink">Folders</h3>
        <button
          onClick={() => onNewFolder(null)}
          className="p-1 rounded-lg hover:bg-card2 text-ink2"
          title="New Folder"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="p-4 text-center text-xs text-ink3">Loading folders...</div>
        ) : (
          <div>
            <div
              className={cx(
                'flex items-center gap-1.5 py-1.5 mx-2 rounded-lg text-sm transition-all cursor-pointer',
                !activeFolderId ? 'bg-brand/15 text-brand' : 'text-ink2 hover:bg-card2 hover:text-ink',
              )}
              onClick={() => onSelectFolder(null)}
            >
              <FileText size={14} />
              <span>All Documents</span>
            </div>
            {folders.length > 0 ? renderTree(folders) : (
              <div className="p-4 text-center text-xs text-ink3">No folders yet</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface DocumentBreadcrumbsProps {
  folders: FolderNode[];
  activeFolderId: number | null;
  onSelectFolder: (folderId: number | null) => void;
}

export function DocumentBreadcrumbs({ folders, activeFolderId, onSelectFolder }: DocumentBreadcrumbsProps) {
  const [folderMap, setFolderMap] = useState<Record<number, FolderNode>>({});
  const [pathCache, setPathCache] = useState<Record<number, FolderNode[]>>({});

  useEffect(() => {
    const map: Record<number, FolderNode> = {};
    const buildMap = (nodes: FolderNode[]) => {
      nodes.forEach((f) => {
        map[f.id] = f;
        if (f.children) buildMap(f.children);
      });
    };
    buildMap(folders);
    setFolderMap(map);
  }, [folders]);

  const breadcrumbPath = useMemo(() => {
    const path: FolderNode[] = [];
    let currentId = activeFolderId;
    while (currentId !== null && currentId !== undefined) {
      const node = folderMap[currentId];
      if (!node) break;
      path.unshift(node);
      currentId = node.parent_id;
    }
    return path;
  }, [activeFolderId, folderMap]);

  return (
    <div className="flex items-center gap-1.5 text-sm mb-3">
      <button
        onClick={() => onSelectFolder(null)}
        className={cx('text-ink3 hover:text-ink', !activeFolderId && 'text-brand font-medium')}
      >
        DMS
      </button>
      {breadcrumbPath.map((folder, i) => (
        <React.Fragment key={folder.id}>
          <ChevronRight size={14} className="text-ink3" />
          <button
            onClick={() => onSelectFolder(folder.id)}
            className={cx(
              'hover:text-ink',
              i === breadcrumbPath.length - 1 ? 'text-brand font-medium' : 'text-ink3',
            )}
          >
            {folder.name}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
