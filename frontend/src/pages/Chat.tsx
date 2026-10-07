import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  Send, Edit2, X, Save, MessageSquare, Download, BarChart3, History, Archive,
  RefreshCw, AlertCircle, ShieldCheck, Search, Users, ArrowLeft, UserPlus, Plus,
  Settings as SettingsIcon, UserMinus, LogOut, Trash2, Smile, Paperclip, FileText, FileImage
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { playNotificationSound } from '../lib/notificationSound';
import { Modal, useToast, Skeleton, EmptyState, ConfirmModal, Avatar } from '../components/ui';
import { cx, timeAgo, fmtDateTime } from '../lib/utils';
import type { ChatMessage, ChatStats, ChatUser, ChatConversation, ChatGroup, ChatGroupMember, ChatGroupConversation, ChatAttachment } from '../lib/types';
import { EmojiPicker, useEmojiInsert } from '../components/EmojiPicker';
import { AttachmentViewer } from '../components/AttachmentViewer';

type TabKey = 'direct' | 'groups';

export default function Chat() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();

  // Sidebar
  const [tab, setTab] = useState<TabKey>('direct');
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [groupConversations, setGroupConversations] = useState<ChatGroupConversation[]>([]);
  const [availableUsers, setAvailableUsers] = useState<ChatUser[]>([]);
  const [allChatUsers, setAllChatUsers] = useState<ChatUser[]>([]);
  const [activeOtherUser, setActiveOtherUser] = useState<ChatUser | null>(null);
  const [activeGroup, setActiveGroup] = useState<ChatGroup | null>(null);
  const [activeGroupMembers, setActiveGroupMembers] = useState<ChatGroupMember[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // Messages
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerAttachments, setViewerAttachments] = useState<ChatAttachment[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');

  // @mention
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionUsers, setMentionUsers] = useState<ChatUser[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Admin modals
  const [showStats, setShowStats] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [stats, setStats] = useState<ChatStats | null>(null);
  const [backupMessages, setBackupMessages] = useState<ChatMessage[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupSearch, setBackupSearch] = useState('');
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(30);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  // Group management modals
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<number[]>([]);
  const [newGroupUserSearch, setNewGroupUserSearch] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  const [showManageGroup, setShowManageGroup] = useState(false);
  const [manageAddSearch, setManageAddSearch] = useState('');
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [confirmLeaveGroup, setConfirmLeaveGroup] = useState(false);
  const [confirmDeactivateGroup, setConfirmDeactivateGroup] = useState(false);
  const [confirmRemoveMember, setConfirmRemoveMember] = useState<{ groupId: number; userId: number; name: string } | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const insertEmoji = useEmojiInsert(inputRef, newMessage, setNewMessage);

  const loadConversations = useCallback(async () => {
    try {
      const data = await api.get<{ conversations: ChatConversation[]; groups: ChatGroupConversation[]; available_users: ChatUser[] }>('/chat/conversations');
      setConversations(data.conversations || []);
      setGroupConversations(data.groups || []);
      setAvailableUsers(data.available_users || []);
      window.dispatchEvent(new CustomEvent('chat:unread-changed'));
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, []);

  const loadAllChatUsers = useCallback(async () => {
    try {
      const data = await api.get<{ users: ChatUser[] }>('/chat/users', {});
      setAllChatUsers(data.users || []);
    } catch (err) {
      console.error('Failed to load all chat users:', err);
    }
  }, []);

  const loadGroupMembers = useCallback(async (groupId: number) => {
    try {
      const data = await api.get<{ members: ChatGroupMember[]; is_admin: boolean; my_role: string | null }>(`/chat/groups/${groupId}`);
      setActiveGroupMembers(data.members || []);
    } catch (err) {
      console.error('Failed to load group members:', err);
    }
  }, []);

  const loadMessages = useCallback(async (params: { otherUserId?: number | null; groupId?: number | null }) => {
    if (!params.otherUserId && !params.groupId) {
      setMessages([]);
      return;
    }
    try {
      const query: Record<string, string | number | undefined> = { limit: 200 };
      if (params.otherUserId) query.otherUserId = params.otherUserId;
      if (params.groupId) query.groupId = params.groupId;
      const data = await api.get<{ messages: ChatMessage[] }>('/chat/messages', query);
      setMessages(data.messages || []);
      await api.post('/chat/messages/read', params).catch(() => {});
      window.dispatchEvent(new CustomEvent('chat:unread-changed'));
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api.get<ChatStats>('/chat/backup/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }, [isAdmin]);

  const loadBackup = useCallback(async (search?: string) => {
    if (!isAdmin) return;
    setBackupLoading(true);
    try {
      const data = await api.get<{ messages: ChatMessage[]; total: number }>('/chat/backup', { limit: 500, search });
      setBackupMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to load backup:', err);
    } finally {
      setBackupLoading(false);
    }
  }, [isAdmin]);

  const loadMentionUsers = useCallback(async (q: string) => {
    try {
      const data = await api.get<{ users: ChatUser[] }>('/chat/users', { q });
      setMentionUsers(data.users || []);
    } catch (err) {
      console.error('Failed to load mention users:', err);
    }
  }, []);

  useEffect(() => {
    loadConversations();
    loadAllChatUsers();
  }, [loadConversations, loadAllChatUsers]);

  useEffect(() => {
    if (activeOtherUser) {
      setLoading(true);
      loadMessages({ otherUserId: activeOtherUser.id });
    } else if (activeGroup) {
      setLoading(true);
      loadMessages({ groupId: activeGroup.id });
      loadGroupMembers(activeGroup.id);
    } else {
      setMessages([]);
      setActiveGroupMembers([]);
      setLoading(false);
      api.post('/chat/messages/read', {}).catch(() => {});
      window.dispatchEvent(new CustomEvent('chat:unread-changed'));
    }
  }, [activeOtherUser, activeGroup, loadMessages, loadGroupMembers]);

  // Real-time: refresh messages and conversations when a new message arrives via SSE
  useEffect(() => {
    const handler = (e?: Event) => {
      const event = e as CustomEvent;
      const fromMe = event?.detail?.sender_id === user?.id;
      if (!fromMe && document.hidden) {
        playNotificationSound('chat');
      }
      loadConversations();
      if (activeOtherUser) {
        loadMessages({ otherUserId: activeOtherUser.id });
      } else if (activeGroup) {
        loadMessages({ groupId: activeGroup.id });
        loadGroupMembers(activeGroup.id);
      }
    };
    window.addEventListener('chat:new-message', handler);
    return () => window.removeEventListener('chat:new-message', handler);
  }, [activeOtherUser, activeGroup, loadMessages, loadGroupMembers, loadConversations, user?.id]);

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(() => {
      loadConversations();
      if (activeOtherUser) loadMessages({ otherUserId: activeOtherUser.id });
      else if (activeGroup) {
        loadMessages({ groupId: activeGroup.id });
        loadGroupMembers(activeGroup.id);
      }
    }, 15000);
    return () => clearInterval(iv);
  }, [autoRefresh, loadConversations, loadMessages, loadGroupMembers, activeOtherUser, activeGroup]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    if (!inputRef.current) return;
    const cursorPos = inputRef.current.selectionStart || 0;
    const textBeforeCursor = newMessage.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex >= 0) {
      const afterAt = textBeforeCursor.slice(lastAtIndex + 1);
      if (!/\s/.test(afterAt)) {
        setShowMentionList(true);
        setMentionSearch(afterAt);
        setMentionIndex(0);
        // In a group, mention from group members; otherwise all users
        if (activeGroup && activeGroupMembers.length > 0) {
          const q = afterAt.toLowerCase();
          // Group members are filtered client-side, so unavailable people are
          // shown greyed out with their reason rather than silently dropped.
          const list = activeGroupMembers
            .filter((m) => m.user_id !== user?.id)
            .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
            .slice(0, 12)
            .map<ChatUser>((m) => ({
              id: m.user_id,
              name: m.name,
              email: m.email,
              role: m.user_role,
              avatar: m.avatar,
              live_status: m.live_status,
              role_group_color: m.role_group_color,
              availability: m.availability,
            }));
          setMentionUsers(list);
        } else {
          loadMentionUsers(afterAt);
        }
        return;
      }
    }
    setShowMentionList(false);
  }, [newMessage, loadMentionUsers, activeGroup, activeGroupMembers, user?.id]);

  const insertMention = (u: ChatUser) => {
    // Someone on leave or on their weekend cannot be mentioned, so refuse the
    // insertion and say why instead of queueing work they cannot do.
    if (u.availability && !u.availability.available) {
      toast(u.availability.reason || 'This user is unavailable and cannot be mentioned.', 'error');
      return;
    }
    const cursorPos = inputRef.current?.selectionStart || newMessage.length;
    const textBeforeCursor = newMessage.slice(0, cursorPos);
    const textAfterCursor = newMessage.slice(cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex >= 0) {
      const before = newMessage.slice(0, lastAtIndex);
      const newText = `${before}@${u.name} ${textAfterCursor}`;
      setNewMessage(newText);
      setShowMentionList(false);
      setTimeout(() => {
        inputRef.current?.focus();
        const newPos = lastAtIndex + u.name.length + 2;
        inputRef.current?.setSelectionRange(newPos, newPos);
      }, 0);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newMessage.trim();
    if (!trimmed && selectedFiles.length === 0) return;
    if (!activeOtherUser && !activeGroup) return;

    setSending(true);
    try {
      let lastMessageId = null;
      const payload: any = { content: trimmed };
      if (activeGroup) payload.groupId = activeGroup.id;
      else if (activeOtherUser) payload.recipientId = activeOtherUser.id;

      const data = await api.post<{
        message: ChatMessage;
        mentioned: number[];
        blocked_mentions?: { user_id: number; name: string; reason: string }[];
      }>('/chat/messages', payload);
      lastMessageId = data.message.id;
      setMessages((prev) => [...prev, data.message]);
      setNewMessage('');

      // The server drops mentions of anyone on leave or on their weekend.
      // Report each one rather than letting the message look delivered.
      for (const blocked of data.blocked_mentions || []) {
        toast(`${blocked.reason} (@${blocked.name} was not mentioned)`, 'error');
      }

      if (selectedFiles.length > 0) {
        setUploadingFiles(true);
        const fd = new FormData();
        selectedFiles.forEach((f) => fd.append('files', f));
        try {
          const attRes = await api.upload<ChatAttachment[]>(`/uploads/chat/${lastMessageId}`, fd);
          setMessages((prev) => prev.map((m) => m.id === lastMessageId ? { ...m, attachments: attRes } : m));
        } catch (err: any) {
          toast(err?.message || 'Attachment upload failed', 'error');
        } finally {
          setUploadingFiles(false);
          setSelectedFiles([]);
        }
      }

      inputRef.current?.focus();
    } catch (err: any) {
      toast(err?.message || 'Failed to send message', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Arrow/Enter navigation must move over the mentionable users only, matching
    // what the list actually renders.
    const mentionable = mentionUsers.filter((u) => u.availability?.available !== false);
    if (showMentionList && mentionable.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionable.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionable.length) % mentionable.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionable[Math.min(mentionIndex, mentionable.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionList(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const startEdit = (m: ChatMessage) => {
    setEditingId(m.id);
    setEditingContent(m.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingContent('');
  };

  const saveEdit = async (id: number) => {
    const trimmed = editingContent.trim();
    if (!trimmed) return;
    try {
      const data = await api.put<{ message: ChatMessage }>(`/chat/messages/${id}`, { content: trimmed });
      setMessages((prev) => prev.map((m) => (m.id === id ? data.message : m)));
      cancelEdit();
      toast('Message updated');
    } catch (err: any) {
      toast(err?.message || 'Failed to update message', 'error');
    }
  };

  const handleCleanup = async () => {
    setCleanupBusy(true);
    try {
      const data = await api.post<{ ok: boolean; deleted: number }>('/chat/backup/cleanup', { daysOld: cleanupDays });
      toast(`Cleaned up ${data.deleted} messages older than ${cleanupDays} days`);
      setCleanupOpen(false);
      loadStats();
      loadConversations();
      if (activeOtherUser) loadMessages({ otherUserId: activeOtherUser.id });
      else if (activeGroup) loadMessages({ groupId: activeGroup.id });
      if (showBackup) loadBackup(backupSearch);
    } catch (err: any) {
      toast(err?.message || 'Failed to clean up old messages', 'error');
    } finally {
      setCleanupBusy(false);
    }
  };

  // Group management handlers
  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toast('Group name is required', 'error');
      return;
    }
    setCreatingGroup(true);
    try {
      await api.post('/chat/groups', {
        name,
        description: newGroupDescription.trim(),
        memberIds: newGroupMemberIds,
      });
      toast(`Group "${name}" created`);
      setShowCreateGroup(false);
      setNewGroupName('');
      setNewGroupDescription('');
      setNewGroupMemberIds([]);
      setNewGroupUserSearch('');
      loadConversations();
    } catch (err: any) {
      toast(err?.message || 'Failed to create group', 'error');
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleAddMember = async (userId: number) => {
    if (!activeGroup) return;
    try {
      await api.post(`/chat/groups/${activeGroup.id}/members`, { userIds: [userId] });
      toast('Member added');
      loadGroupMembers(activeGroup.id);
      loadConversations();
    } catch (err: any) {
      toast(err?.message || 'Failed to add member', 'error');
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!activeGroup) return;
    try {
      await api.delete(`/chat/groups/${activeGroup.id}/members/${userId}`);
      toast('Member removed');
      loadGroupMembers(activeGroup.id);
      loadConversations();
    } catch (err: any) {
      toast(err?.message || 'Failed to remove member', 'error');
    }
  };

  const handleLeaveGroup = async () => {
    if (!activeGroup) return;
    setLeavingGroup(true);
    try {
      await api.post(`/chat/groups/${activeGroup.id}/leave`);
      toast('You left the group');
      setConfirmLeaveGroup(false);
      setShowManageGroup(false);
      setActiveGroup(null);
      setMessages([]);
      setActiveGroupMembers([]);
      loadConversations();
    } catch (err: any) {
      toast(err?.message || 'Failed to leave group', 'error');
    } finally {
      setLeavingGroup(false);
    }
  };

  const handleDeactivateGroup = async () => {
    if (!activeGroup) return;
    try {
      await api.post(`/chat/groups/${activeGroup.id}/deactivate`);
      toast('Group deactivated');
      setConfirmDeactivateGroup(false);
      setShowManageGroup(false);
      setActiveGroup(null);
      setMessages([]);
      setActiveGroupMembers([]);
      loadConversations();
    } catch (err: any) {
      toast(err?.message || 'Failed to deactivate group', 'error');
    }
  };

  const openManageGroup = () => {
    if (!activeGroup) return;
    setShowManageGroup(true);
    loadGroupMembers(activeGroup.id);
  };

  const exportBackupCSV = () => {
    if (!backupMessages.length) {
      toast('No messages to export', 'error');
      return;
    }
    const header = ['ID', 'Sender', 'Email', 'Role', 'Recipient', 'Content', 'Type', 'Created At', 'Updated At'];
    const rows = backupMessages.map((m) => [
      m.id,
      m.sender_name,
      m.sender_email || '',
      m.sender_role,
      m.recipient_name || '(Group)',
      `"${(m.content || '').replace(/"/g, '""')}"`,
      m.recipient_id ? 'Direct' : 'Group',
      m.created_at,
      m.updated_at,
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-backup-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup exported as CSV');
  };

  const filteredMessages = searchQuery
    ? messages.filter((m) =>
        m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.sender_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

  const sidebarUsers = useMemo(() => {
    const map = new Map<number, ChatUser & { last_message?: any; unread_count?: number }>();
    conversations.forEach((c) => {
      map.set(c.other_user.id, { ...c.other_user, last_message: c.last_message, unread_count: c.unread_count });
    });
    if (isAdmin) {
      availableUsers.forEach((u) => {
        if (!map.has(u.id)) {
          map.set(u.id, { ...u, last_message: null, unread_count: 0 });
        }
      });
    }
    let list = Array.from(map.values());
    if (userSearchQuery.trim()) {
      const q = userSearchQuery.toLowerCase();
      list = list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if ((b.unread_count || 0) !== (a.unread_count || 0)) return (b.unread_count || 0) - (a.unread_count || 0);
      const aTime = a.last_message?.created_at || '';
      const bTime = b.last_message?.created_at || '';
      return bTime.localeCompare(aTime);
    });
    return list;
  }, [conversations, availableUsers, isAdmin, userSearchQuery]);

  const filteredGroups = useMemo(() => {
    let list = [...groupConversations];
    if (userSearchQuery.trim()) {
      const q = userSearchQuery.toLowerCase();
      list = list.filter((g) => g.group.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if ((b.unread_count || 0) !== (a.unread_count || 0)) return (b.unread_count || 0) - (a.unread_count || 0);
      const aTime = a.last_message?.created_at || '';
      const bTime = b.last_message?.created_at || '';
      return bTime.localeCompare(aTime);
    });
    return list;
  }, [groupConversations, userSearchQuery]);

  const availableUsersForCreate = useMemo(() => {
    const set = new Set(newGroupMemberIds);
    return (allChatUsers.length > 0 ? allChatUsers : availableUsers).filter((u) => !set.has(u.id));
  }, [allChatUsers, availableUsers, newGroupMemberIds]);

  const filteredNewGroupUsers = useMemo(() => {
    if (!newGroupUserSearch.trim()) return availableUsersForCreate;
    const q = newGroupUserSearch.toLowerCase();
    return availableUsersForCreate.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [availableUsersForCreate, newGroupUserSearch]);

  const groupMembersForManage = activeGroupMembers;
  const memberIdsInGroup = useMemo(() => new Set(activeGroupMembers.map((m) => m.user_id)), [activeGroupMembers]);
  const addableUsersForManage = useMemo(() => {
    const set = memberIdsInGroup;
    let list = (allChatUsers.length > 0 ? allChatUsers : availableUsers).filter((u) => !set.has(u.id));
    if (manageAddSearch.trim()) {
      const q = manageAddSearch.toLowerCase();
      list = list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    return list;
  }, [allChatUsers, availableUsers, memberIdsInGroup, manageAddSearch]);

  const isGroupAdmin = useMemo(() => {
    if (!activeGroup) return false;
    const me = activeGroupMembers.find((m) => m.user_id === user?.id);
    return me?.role === 'admin' || isAdmin;
  }, [activeGroup, activeGroupMembers, user?.id, isAdmin]);

  const isGroupCreator = activeGroup?.created_by === user?.id;

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'super_admin': return 'from-purple-500 to-pink-500';
      case 'admin': return 'from-blue-500 to-cyan-500';
      case 'sub_admin': return 'from-emerald-500 to-teal-500';
      default: return 'from-slate-500 to-slate-600';
    }
  };

  const getChatFileIcon = (mime?: string, filename?: string) => {
    const ext = (filename || '').split('.').pop()?.toLowerCase();
    if (mime?.startsWith('image') || ['jpg', 'jpeg', 'png'].includes(ext || '')) return <FileImage size={16} className="text-ink3" />;
    if (mime === 'application/pdf' || ext === 'pdf') return <FileText size={16} className="text-red-500" />;
    return <FileText size={16} className="text-ink3" />;
  };

  const renderChatAttachments = (att: ChatAttachment[], isOwn: boolean) => {
    if (!att.length) return null;
    return (
      <div className="flex flex-wrap gap-1.5 mt-1">
        {att.map((a) => {
          const isImage = a.mime?.startsWith('image') || /\.(jpg|jpeg|png)$/i.test(a.stored_name);
          const isPdf = a.mime === 'application/pdf' || a.stored_name.toLowerCase().endsWith('.pdf');
          return (
            <div key={a.id} className={cx('flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs', isOwn ? 'bg-white/15 border border-white/20' : 'bg-card border border-line')}>
              {getChatFileIcon(a.mime, a.filename)}
              <div
                className="min-w-0 flex-1 cursor-pointer"
                onClick={() => {
                  setViewerAttachments(att);
                  setViewerIndex(att.findIndex((x) => x.id === a.id));
                  setViewerOpen(true);
                }}
              >
                <span className={cx('truncate block max-w-[140px]', isOwn ? 'text-white/90' : 'text-ink2')}>
                  {a.filename}
                </span>
                <span className={cx('text-[9px]', isOwn ? 'text-white/60' : 'text-ink4')}>{Math.round(a.size / 1024)} KB</span>
              </div>
              <a
                href={`/api/uploads/file/${a.stored_name}/download`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={cx('p-0.5 rounded hover:bg-card2', isOwn ? 'text-white/80 hover:text-white' : 'text-ink3 hover:text-ink')}
                title="Download"
              >
                <Download size={10} />
              </a>
            </div>
          );
        })}
      </div>
    );
  };

  const renderContent = (content: string) => {
    const parts = content.split(/(@[\w\s.]+?)(?=\s|$|[^a-zA-Z0-9])/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="px-1 rounded bg-brand/20 text-brand font-semibold">
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="card p-0 flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-72 shrink-0 border-r border-line flex flex-col bg-card2/30 hidden md:flex">
          <div className="p-3 border-b border-line">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand to-brand2 flex items-center justify-center text-white shadow">
                <MessageSquare size={16} />
              </div>
              <h2 className="font-bold text-ink text-sm flex-1">Conversations</h2>
            </div>
            <div className="flex items-center gap-1 mb-2 p-0.5 rounded-lg bg-card border border-line">
              <button
                onClick={() => setTab('direct')}
                className={cx(
                  'flex-1 px-2 py-1 text-xs font-semibold rounded-md transition-colors',
                  tab === 'direct' ? 'bg-brand text-white' : 'text-ink2 hover:text-ink'
                )}
              >
                Direct
              </button>
              <button
                onClick={() => setTab('groups')}
                className={cx(
                  'flex-1 px-2 py-1 text-xs font-semibold rounded-md transition-colors',
                  tab === 'groups' ? 'bg-brand text-white' : 'text-ink2 hover:text-ink'
                )}
              >
                Groups
                {groupConversations.reduce((s, g) => s + g.unread_count, 0) > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-bad text-white text-[9px] font-bold">
                    {groupConversations.reduce((s, g) => s + g.unread_count, 0)}
                  </span>
                )}
              </button>
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                placeholder={tab === 'direct' ? 'Search users...' : 'Search groups...'}
                className="input !pl-7 !py-1.5 !text-xs rounded-lg w-full"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === 'direct' ? (
              sidebarUsers.length === 0 ? (
                <div className="p-4 text-center text-xs text-ink3">
                  <Users size={20} className="mx-auto mb-2 opacity-30" />
                  No users found
                </div>
              ) : (
                sidebarUsers.map((u) => {
                  const isActive = activeOtherUser?.id === u.id;
                  const lastMsg = u.last_message;
                  return (
                    <button
                      key={u.id}
                      onClick={() => { setActiveOtherUser(u); setActiveGroup(null); setSearchQuery(''); }}
                      className={cx(
                        'w-full px-3 py-2.5 flex items-center gap-2.5 hover:bg-card2 transition-colors text-left border-b border-line/50',
                        isActive && 'bg-brand/10 border-l-2 border-l-brand'
                      )}
                    >
                      <div className="relative shrink-0">
                        <div className={cx('w-10 h-10 rounded-full bg-gradient-to-br text-white text-sm font-bold flex items-center justify-center shadow', getRoleColor(u.role))}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        {u.live_status === 'active' && (
                          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-card" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className={cx('text-sm truncate', (u.unread_count || 0) > 0 ? 'font-bold text-ink' : 'font-medium text-ink')}>
                            {u.name}
                          </span>
                          {lastMsg && (
                            <span className="text-[10px] text-ink3 shrink-0">{timeAgo(lastMsg.created_at)}</span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs text-ink3 truncate">
                            {lastMsg ? (lastMsg.sender_id === user?.id ? 'You: ' : '') + lastMsg.content : u.email}
                          </p>
                          {(u.unread_count || 0) > 0 && (
                            <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center">
                              {u.unread_count! > 9 ? '9+' : u.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )
            ) : filteredGroups.length === 0 ? (
              <div className="p-4 text-center text-xs text-ink3">
                <Users size={20} className="mx-auto mb-2 opacity-30" />
                No groups yet
                {isAdmin && <p className="mt-1">Create one with the button below</p>}
              </div>
            ) : (
              filteredGroups.map((g) => {
                const isActive = activeGroup?.id === g.group.id;
                const lastMsg = g.last_message;
                return (
                  <button
                    key={g.group.id}
                    onClick={() => { setActiveGroup(g.group); setActiveOtherUser(null); setSearchQuery(''); }}
                    className={cx(
                      'w-full px-3 py-2.5 flex items-center gap-2.5 hover:bg-card2 transition-colors text-left border-b border-line/50',
                      isActive && 'bg-brand/10 border-l-2 border-l-brand'
                    )}
                  >
                    <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-white text-sm font-bold flex items-center justify-center shadow">
                      <Users size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className={cx('text-sm truncate', (g.unread_count || 0) > 0 ? 'font-bold text-ink' : 'font-medium text-ink')}>
                          {g.group.name}
                        </span>
                        {lastMsg && (
                          <span className="text-[10px] text-ink3 shrink-0">{timeAgo(lastMsg.created_at)}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs text-ink3 truncate">
                          {lastMsg ? (lastMsg.sender_id === user?.id ? 'You: ' : '') + lastMsg.content : `${g.group.member_count || 0} members`}
                        </p>
                        {(g.unread_count || 0) > 0 && (
                          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center">
                            {g.unread_count! > 9 ? '9+' : g.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          {tab === 'groups' && isAdmin && (
            <div className="p-2 border-t border-line">
              <button
                onClick={() => { setShowCreateGroup(true); setNewGroupMemberIds([]); setNewGroupName(''); setNewGroupDescription(''); setNewGroupUserSearch(''); }}
                className="w-full px-2 py-1.5 rounded-lg bg-brand text-white hover:bg-brand/90 transition-colors flex items-center justify-center gap-1.5 text-xs font-semibold"
              >
                <Plus size={13} /> New Group
              </button>
            </div>
          )}
          {isAdmin && (
            <div className="p-2 border-t border-line flex gap-1.5">
              <button onClick={() => { setShowStats(true); loadStats(); }} className="flex-1 px-2 py-1.5 rounded-lg hover:bg-card text-ink2 hover:text-ink transition-colors flex items-center justify-center gap-1.5 text-xs" title="Statistics">
                <BarChart3 size={13} /> Stats
              </button>
              <button onClick={() => { setShowBackup(true); loadBackup(); }} className="flex-1 px-2 py-1.5 rounded-lg hover:bg-card text-ink2 hover:text-ink transition-colors flex items-center justify-center gap-1.5 text-xs" title="Backup">
                <Archive size={13} /> Backup
              </button>
            </div>
          )}
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {!activeOtherUser && !activeGroup ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <EmptyState
                icon={<MessageSquare size={28} />}
                title="Select a conversation"
                subtitle="Choose a user or group from the sidebar to start chatting. Use @username to mention someone."
              />
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="flex items-center gap-3 p-3 border-b border-line bg-card">
                <button
                  onClick={() => { setActiveOtherUser(null); setActiveGroup(null); }}
                  className="md:hidden p-1.5 rounded-lg hover:bg-card2"
                  title="Back"
                >
                  <ArrowLeft size={18} />
                </button>
                {activeGroup ? (
                  <>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-white text-sm font-bold flex items-center justify-center shadow shrink-0">
                      <Users size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-semibold text-ink truncate">{activeGroup.name}</h3>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 font-bold border border-purple-500/30">GROUP</span>
                      </div>
                      <p className="text-xs text-ink3 truncate">
                        {activeGroupMembers.length} member{activeGroupMembers.length === 1 ? '' : 's'}
                        {activeGroup.description ? ` • ${activeGroup.description}` : ''}
                      </p>
                    </div>
                  </>
                ) : activeOtherUser && (
                  <>
                    <div className={cx('w-10 h-10 rounded-full bg-gradient-to-br text-white text-sm font-bold flex items-center justify-center shadow shrink-0', getRoleColor(activeOtherUser.role))}>
                      {activeOtherUser.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-semibold text-ink truncate">{activeOtherUser.name}</h3>
                        {activeOtherUser.role === 'super_admin' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 font-bold border border-purple-500/30">SUPER</span>
                        )}
                        {activeOtherUser.role === 'admin' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold border border-blue-500/30">ADMIN</span>
                        )}
                      </div>
                      <p className="text-xs text-ink3 truncate">{activeOtherUser.email}</p>
                    </div>
                  </>
                )}
                <div className="flex items-center gap-1">
                  {activeGroup && (
                    <button
                      onClick={openManageGroup}
                      className="p-1.5 rounded-lg hover:bg-card2 text-ink2 transition-colors"
                      title="Manage group"
                    >
                      <SettingsIcon size={14} />
                    </button>
                  )}
                  <div className="relative hidden md:block">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search messages..."
                      className="input !pl-7 !py-1.5 !text-xs rounded-full w-36"
                    />
                  </div>
                  <button
                    onClick={() => setAutoRefresh((a) => !a)}
                    className={cx('p-1.5 rounded-lg border transition-colors', autoRefresh ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' : 'border-line text-ink2 hover:bg-card2')}
                    title={autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
                  >
                    <RefreshCw size={14} className={autoRefresh ? 'animate-spin' : ''} />
                  </button>
                  <button onClick={() => {
                    loadConversations();
                    if (activeOtherUser) loadMessages({ otherUserId: activeOtherUser.id });
                    else if (activeGroup) {
                      loadMessages({ groupId: activeGroup.id });
                      loadGroupMembers(activeGroup.id);
                    }
                  }} className="p-1.5 rounded-lg hover:bg-card2 text-ink2 transition-colors" title="Refresh">
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-card/50 to-card2/20">
                {loading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex gap-3"><Skeleton className="w-9 h-9 rounded-full" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-32" /><Skeleton className="h-12 w-2/3" /></div></div>
                    ))}
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <EmptyState
                    icon={<MessageSquare size={28} />}
                    title={searchQuery ? 'No messages match your search' : 'No messages yet'}
                    subtitle={
                      searchQuery
                        ? 'Try a different search term'
                        : activeGroup
                        ? `Start a conversation in ${activeGroup.name}!`
                        : `Say hi to ${activeOtherUser?.name}!`
                    }
                  />
                ) : (
                  filteredMessages.map((m) => {
                    const isOwn = m.sender_id === user?.id;
                    const isEditing = editingId === m.id;
                    const canEdit = isOwn;

                    return (
                      <div key={m.id} className={cx('flex gap-2.5 group', isOwn && 'flex-row-reverse')}>
                        <div className={cx('w-9 h-9 rounded-full bg-gradient-to-br shrink-0 flex items-center justify-center text-white text-sm font-bold shadow-md', getRoleColor(m.sender_role), isOwn && 'ring-2 ring-brand/30')}>
                          {m.sender_name.charAt(0).toUpperCase()}
                        </div>
                        <div className={cx('flex-1 min-w-0 max-w-[75%]', isOwn && 'flex flex-col items-end')}>
                          <div className={cx('flex items-center gap-2 mb-1', isOwn && 'flex-row-reverse')}>
                            <span className="text-xs font-semibold text-ink">{m.sender_name}</span>
                            <span className="text-[10px] text-ink3">{timeAgo(m.created_at)}</span>
                            {m.updated_at !== m.created_at && (
                              <span className="text-[10px] text-ink3 italic">(edited)</span>
                            )}
                          </div>
                          {isEditing ? (
                            <div className="w-full max-w-md">
                              <textarea
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                className="input !py-2 text-sm w-full"
                                rows={2}
                                autoFocus
                              />
                              <div className="flex gap-2 mt-2">
                                <button onClick={() => saveEdit(m.id)} className="px-3 py-1 text-xs rounded-lg bg-brand text-white font-medium hover:bg-brand/90 flex items-center gap-1">
                                  <Save size={12} /> Save
                                </button>
                                <button onClick={cancelEdit} className="px-3 py-1 text-xs rounded-lg bg-card2 text-ink2 font-medium hover:bg-card flex items-center gap-1">
                                  <X size={12} /> Cancel
                                </button>
                              </div>
                            </div>
                           ) : (
                             <div
                               className={cx(
                                 'inline-block px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words',
                                 isOwn
                                   ? 'bg-gradient-to-br from-brand to-brand2 text-white rounded-tr-sm'
                                   : 'bg-card2 rounded-tl-sm border border-line text-ink'
                               )}
                             >
                               {renderContent(m.content)}
                               {renderChatAttachments(m.attachments || [], isOwn)}
                             </div>
                           )}
                          {!isEditing && canEdit && (
                            <div className={cx('flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity', isOwn && 'justify-end')}>
                              <button onClick={() => startEdit(m)} className="p-1 rounded hover:bg-card2 text-ink3 hover:text-ink" title="Edit">
                                <Edit2 size={11} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Input */}
              <form onSubmit={handleSend} className="p-3 border-t border-line bg-card relative">
                {showMentionList && mentionUsers.length > 0 && (() => {
                  // Unavailable people stay visible so the reason is obvious,
                  // but they cannot be selected for a mention.
                  const mentionable = mentionUsers.filter((u) => u.availability?.available !== false);
                  const blocked = mentionUsers.length - mentionable.length;
                  if (mentionable.length === 0) {
                    return (
                      <div className="absolute bottom-full left-3 right-3 mb-1 card anim-pop border border-line shadow-2xl z-50">
                        <div className="px-3 py-1.5 text-[10px] text-ink3 font-semibold uppercase tracking-wider border-b border-line bg-card2/50 flex items-center gap-1">
                          Mention someone
                        </div>
                        {mentionUsers.map((u) => (
                          <div key={u.id} className="px-3 py-2 flex items-center gap-2 opacity-70">
                            <div className={cx('w-7 h-7 rounded-full bg-gradient-to-br text-white text-xs font-bold flex items-center justify-center shrink-0', getRoleColor(u.role))}>
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-ink truncate">{u.name}</div>
                              <div className="text-[10px] text-amber-600 dark:text-amber-400 truncate">
                                {u.availability?.status === 'weekend' ? 'On Weekend' : 'On Leave'} — cannot be mentioned
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return (
                  <div className="absolute bottom-full left-3 right-3 mb-1 card anim-pop border border-line shadow-2xl max-h-60 overflow-y-auto z-50">
                    <div className="px-3 py-1.5 text-[10px] text-ink3 font-semibold uppercase tracking-wider border-b border-line bg-card2/50 flex items-center gap-1">
                      Mention someone ({mentionable.length})
                      {blocked > 0 && (
                        <span className="ml-auto normal-case tracking-normal text-amber-600 dark:text-amber-400 font-medium">
                          {blocked} unavailable
                        </span>
                      )}
                    </div>
                    {mentionable.map((u) => {
                      const idx = mentionable.indexOf(u);
                      return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => insertMention(u)}
                        onMouseEnter={() => setMentionIndex(idx)}
                        className={cx(
                          'w-full px-3 py-2 flex items-center gap-2 hover:bg-card2 text-left transition-colors',
                          idx === mentionIndex && 'bg-brand/10'
                        )}
                      >
                        <div className={cx('w-7 h-7 rounded-full bg-gradient-to-br text-white text-xs font-bold flex items-center justify-center shrink-0', getRoleColor(u.role))}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink truncate">{u.name}</div>
                          <div className="text-[10px] text-ink3 truncate">{u.email}</div>
                        </div>
                        {u.role === 'super_admin' && <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-600 font-bold">SUPER</span>}
                        {u.role === 'admin' && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-600 font-bold">ADMIN</span>}
                      </button>
                      );
                    })}
                  </div>
                  );
                })()}
                <div className="flex gap-2 items-end">
                  <EmojiPicker onEmojiSelect={insertEmoji} />
                  <textarea
                    ref={inputRef}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      activeGroup
                        ? `Message ${activeGroup.name}... Type @ to mention a member`
                        : activeOtherUser
                        ? `Message ${activeOtherUser.name}... Type @ to mention`
                        : 'Type a message...'
                    }
                    className="input flex-1 !py-2.5 resize-none"
                    rows={1}
                    disabled={sending || uploadingFiles}
                    maxLength={5000}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length + selectedFiles.length > 10) {
                        toast('Maximum 10 files per message', 'error');
                        return;
                      }
                      setSelectedFiles((prev) => [...prev, ...files]);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending || uploadingFiles}
                    className="p-2 rounded-lg hover:bg-card2 text-ink2 transition-colors"
                    title="Attach files (JPG, PNG, PDF - 2MB each)"
                  >
                    <Paperclip size={18} />
                  </button>
                  <button
                    type="submit"
                    disabled={sending || uploadingFiles || (!newMessage.trim() && selectedFiles.length === 0)}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand to-brand2 text-white font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-2 shadow-lg"
                  >
                    {sending || uploadingFiles ? <RefreshCw size={16} className={uploadingFiles ? 'animate-spin' : ''} /> : <Send size={16} />}
                  </button>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-card2 border border-line text-xs">
                        {f.type.startsWith('image') ? <FileImage size={12} className="text-ink3" /> : <FileText size={12} className="text-ink3" />}
                        <span className="text-ink2 max-w-[100px] truncate">{f.name}</span>
                        <span className="text-[10px] text-ink4">({(f.size / 1024).toFixed(1)}KB)</span>
                        <button
                          type="button"
                          onClick={() => setSelectedFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="p-0.5 text-ink3 hover:text-bad"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-[10px] text-ink3">
                    <kbd className="px-1 py-0.5 rounded bg-card2 text-[9px] font-mono">Enter</kbd> send • <kbd className="px-1 py-0.5 rounded bg-card2 text-[9px] font-mono">@</kbd> mention • 😊 emoji • 📎 attach
                  </p>
                  <p className="text-[10px] text-ink3">{newMessage.length} / 5000</p>
                </div>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Statistics Modal (Admin only) */}
      {isAdmin && (
        <Modal open={showStats} onClose={() => setShowStats(false)} title="Chat Statistics" width={560}>
          {stats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="card p-3" style={{ background: 'rgb(var(--card-2))' }}>
                  <div className="text-xs text-ink3">Total</div>
                  <div className="text-2xl font-bold text-brand">{stats.total}</div>
                </div>
                <div className="card p-3" style={{ background: 'rgb(var(--card-2))' }}>
                  <div className="text-xs text-ink3">Today</div>
                  <div className="text-2xl font-bold text-emerald-500">{stats.today}</div>
                </div>
                <div className="card p-3" style={{ background: 'rgb(var(--card-2))' }}>
                  <div className="text-xs text-ink3">7 Days</div>
                  <div className="text-2xl font-bold text-amber-500">{stats.last7Days}</div>
                </div>
                <div className="card p-3" style={{ background: 'rgb(var(--card-2))' }}>
                  <div className="text-xs text-ink3">30 Days</div>
                  <div className="text-2xl font-bold text-purple-500">{stats.last30Days}</div>
                </div>
                <div className="card p-3" style={{ background: 'rgb(var(--card-2))' }}>
                  <div className="text-xs text-ink3">Direct</div>
                  <div className="text-2xl font-bold text-cyan-500">{stats.direct || 0}</div>
                </div>
                <div className="card p-3" style={{ background: 'rgb(var(--card-2))' }}>
                  <div className="text-xs text-ink3">Group</div>
                  <div className="text-2xl font-bold text-pink-500">{stats.group || 0}</div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink mb-2">Top Senders</h3>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {stats.topSenders.filter((s) => s.message_count > 0).map((s) => (
                    <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-card2">
                      <div className="flex items-center gap-2">
                        <div className={cx('w-7 h-7 rounded-full bg-gradient-to-br text-white text-xs font-bold flex items-center justify-center', getRoleColor(s.role))}>
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-ink">{s.name}</div>
                          <div className="text-[10px] text-ink3 uppercase">{s.role}</div>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-brand">{s.message_count}</span>
                    </div>
                  ))}
                  {stats.topSenders.filter((s) => s.message_count > 0).length === 0 && (
                    <p className="text-xs text-ink3 text-center py-4">No messages sent yet</p>
                  )}
                </div>
              </div>
              <div className="flex justify-between gap-2 pt-2 border-t border-line">
                <button onClick={() => { setShowStats(false); setCleanupOpen(true); }} className="btn text-sm flex items-center gap-1.5">
                  <History size={14} /> Cleanup Old
                </button>
                <button onClick={() => setShowStats(false)} className="btn btn-primary text-sm">Close</button>
              </div>
            </div>
          ) : (
            <Skeleton className="h-40" />
          )}
        </Modal>
      )}

      {/* Backup Modal (Admin only) */}
      {isAdmin && (
        <Modal open={showBackup} onClose={() => setShowBackup(false)} title="Chat Backup Management" width={900}>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-line flex-wrap">
              <div className="text-xs text-ink3 flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-emerald-500" />
                Admin & Super Admin: 30-day retention with search & export. Messages cannot be deleted.
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => { setShowBackup(false); setCleanupOpen(true); }} className="btn text-xs flex items-center gap-1.5">
                  <History size={12} /> Cleanup
                </button>
                <button onClick={exportBackupCSV} className="btn text-xs flex items-center gap-1.5">
                  <Download size={12} /> Export CSV
                </button>
                <button onClick={() => loadBackup(backupSearch)} className="btn text-xs flex items-center gap-1.5">
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                value={backupSearch}
                onChange={(e) => { setBackupSearch(e.target.value); loadBackup(e.target.value); }}
                placeholder="Search messages, senders, or recipients..."
                className="input !pl-7 !py-1.5 !text-xs w-full"
              />
            </div>
            <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
              {backupLoading ? (
                <Skeleton className="h-40" />
              ) : backupMessages.length === 0 ? (
                <EmptyState icon={<Archive size={28} />} title="No messages" subtitle="No messages match your search" />
              ) : (
                backupMessages.map((m) => (
                  <div key={m.id} className="p-3 rounded-lg bg-card2 border border-line">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={cx('w-7 h-7 rounded-full bg-gradient-to-br text-white text-xs font-bold flex items-center justify-center shrink-0', getRoleColor(m.sender_role))}>
                          {m.sender_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold text-ink truncate">{m.sender_name}</span>
                            <span className="text-[10px] text-ink3">→</span>
                            <span className="text-sm font-medium text-ink2 truncate">
                              {m.recipient_name ? m.recipient_name : <span className="text-purple-600 font-semibold">(Group)</span>}
                            </span>
                            <span className="text-[10px] px-1 py-0.5 rounded bg-card text-ink3">
                              {m.recipient_id ? 'Direct' : 'Group'}
                            </span>
                          </div>
                          <div className="text-[10px] text-ink3">{fmtDateTime(m.created_at)} {m.updated_at !== m.created_at && '(edited)'}</div>
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-ink whitespace-pre-wrap break-words pl-9">{m.content}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Create Group Modal (Admin only) */}
      {isAdmin && (
        <Modal open={showCreateGroup} onClose={() => setShowCreateGroup(false)} title="Create New Group" width={560}>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-ink block mb-1.5">Group Name <span className="text-bad">*</span></label>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="e.g. IT Team, Project Alpha"
                maxLength={100}
                className="input w-full"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium text-ink block mb-1.5">Description (optional)</label>
              <textarea
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
                placeholder="What is this group for?"
                className="input w-full"
                rows={2}
                maxLength={500}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-ink block mb-1.5">Members ({newGroupMemberIds.length} selected)</label>
              {newGroupMemberIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2 p-2 rounded-lg bg-card2 max-h-24 overflow-y-auto">
                  {newGroupMemberIds.map((id) => {
                    const u = availableUsers.find((x) => x.id === id);
                    if (!u) return null;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand/15 text-brand text-xs font-medium">
                        {u.name}
                        <button
                          type="button"
                          onClick={() => setNewGroupMemberIds((prev) => prev.filter((x) => x !== id))}
                          className="hover:text-bad"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="relative mb-1.5">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
                <input
                  value={newGroupUserSearch}
                  onChange={(e) => setNewGroupUserSearch(e.target.value)}
                  placeholder="Search users to add..."
                  className="input !pl-7 !py-1.5 !text-xs w-full"
                />
              </div>
              <div className="max-h-40 overflow-y-auto border border-line rounded-lg">
                {filteredNewGroupUsers.length === 0 ? (
                  <div className="p-3 text-center text-xs text-ink3">No users available</div>
                ) : filteredNewGroupUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setNewGroupMemberIds((prev) => [...prev, u.id])}
                    className="w-full px-2.5 py-1.5 flex items-center gap-2 hover:bg-card2 text-left text-sm"
                  >
                    <div className={cx('w-6 h-6 rounded-full bg-gradient-to-br text-white text-[10px] font-bold flex items-center justify-center shrink-0', getRoleColor(u.role))}>
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-ink truncate">{u.name}</div>
                      <div className="text-[10px] text-ink3 truncate">{u.email}</div>
                    </div>
                    <Plus size={12} className="text-ink3" />
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-ink3 mt-1">You will be added as group admin automatically.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button onClick={() => setShowCreateGroup(false)} className="btn text-sm" disabled={creatingGroup}>Cancel</button>
              <button
                onClick={handleCreateGroup}
                className="btn btn-primary text-sm flex items-center gap-1.5"
                disabled={creatingGroup || !newGroupName.trim() || newGroupMemberIds.length === 0}
              >
                {creatingGroup && <RefreshCw size={12} className="animate-spin" />} Create Group
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Manage Group Modal */}
      <Modal open={showManageGroup} onClose={() => setShowManageGroup(false)} title={`Manage: ${activeGroup?.name || 'Group'}`} width={640}>
        {activeGroup && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-lg bg-card2 flex items-center gap-2 text-xs text-ink2">
              <Users size={14} className="text-brand" />
              <span><strong>{activeGroupMembers.length}</strong> member{activeGroupMembers.length === 1 ? '' : 's'}</span>
              <span className="text-ink3">•</span>
              <span>Created {fmtDateTime(activeGroup.created_at)}</span>
              {activeGroup.description && (
                <>
                  <span className="text-ink3">•</span>
                  <span className="truncate">{activeGroup.description}</span>
                </>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink mb-2">Members</h3>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {groupMembersForManage.length === 0 ? (
                  <div className="p-3 text-center text-xs text-ink3">No members</div>
                ) : groupMembersForManage.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 p-2 rounded-lg bg-card2">
                    <div className={cx('w-8 h-8 rounded-full bg-gradient-to-br text-white text-xs font-bold flex items-center justify-center shrink-0', getRoleColor(m.user_role))}>
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-ink truncate">{m.name}</span>
                        {m.role === 'admin' && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-600 font-bold">ADMIN</span>
                        )}
                        {m.user_id === activeGroup.created_by && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 font-bold">CREATOR</span>
                        )}
                      </div>
                      <div className="text-[10px] text-ink3 truncate">{m.email}</div>
                    </div>
                    {isGroupAdmin && m.user_id !== activeGroup.created_by && (
                      <button
                        onClick={() => setConfirmRemoveMember({ groupId: activeGroup.id, userId: m.user_id, name: m.name })}
                        className="p-1 rounded hover:bg-bad/10 text-ink3 hover:text-bad"
                        title="Remove from group"
                      >
                        <UserMinus size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {isGroupAdmin && (
              <div>
                <h3 className="text-sm font-semibold text-ink mb-2">Add Members</h3>
                <div className="relative mb-1.5">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
                  <input
                    value={manageAddSearch}
                    onChange={(e) => setManageAddSearch(e.target.value)}
                    placeholder="Search users to add..."
                    className="input !pl-7 !py-1.5 !text-xs w-full"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto border border-line rounded-lg">
                  {addableUsersForManage.length === 0 ? (
                    <div className="p-3 text-center text-xs text-ink3">All users are already in this group</div>
                  ) : addableUsersForManage.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => handleAddMember(u.id)}
                      className="w-full px-2.5 py-1.5 flex items-center gap-2 hover:bg-card2 text-left text-sm"
                    >
                      <div className={cx('w-6 h-6 rounded-full bg-gradient-to-br text-white text-[10px] font-bold flex items-center justify-center shrink-0', getRoleColor(u.role))}>
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-ink truncate">{u.name}</div>
                        <div className="text-[10px] text-ink3 truncate">{u.email}</div>
                      </div>
                      <UserPlus size={12} className="text-emerald-500" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-line">
              <div className="flex gap-2">
                {!isGroupCreator && isGroupAdmin && (
                  <button onClick={() => setConfirmLeaveGroup(true)} className="btn text-sm flex items-center gap-1.5">
                    <LogOut size={13} /> Leave Group
                  </button>
                )}
                {isGroupAdmin && (
                  <button onClick={() => setConfirmDeactivateGroup(true)} className="btn text-sm flex items-center gap-1.5 text-bad">
                    <Trash2 size={13} /> Deactivate
                  </button>
                )}
              </div>
              <button onClick={() => setShowManageGroup(false)} className="btn btn-primary text-sm">Close</button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={confirmLeaveGroup}
        onClose={() => setConfirmLeaveGroup(false)}
        onConfirm={handleLeaveGroup}
        title="Leave Group"
        message={`Are you sure you want to leave "${activeGroup?.name}"? You will no longer receive messages from this group.`}
        confirmLabel={leavingGroup ? 'Leaving…' : 'Leave Group'}
        danger
      />

      <ConfirmModal
        open={confirmDeactivateGroup}
        onClose={() => setConfirmDeactivateGroup(false)}
        onConfirm={handleDeactivateGroup}
        title="Deactivate Group"
        message={`Deactivate "${activeGroup?.name}"? The group will be hidden from the sidebar. Existing messages are preserved per the 30-day retention policy.`}
        confirmLabel="Deactivate Group"
        danger
      />

      <ConfirmModal
        open={!!confirmRemoveMember}
        onClose={() => setConfirmRemoveMember(null)}
        onConfirm={() => {
          if (confirmRemoveMember) {
            handleRemoveMember(confirmRemoveMember.userId);
            setConfirmRemoveMember(null);
          }
        }}
        title="Remove Member"
        message={`Remove ${confirmRemoveMember?.name} from this group?`}
        confirmLabel="Remove"
        danger
      />

      {/* Cleanup Modal */}
      <Modal open={cleanupOpen} onClose={() => setCleanupOpen(false)} title="Cleanup Old Messages (30-Day Policy)" width={500}>
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
            <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-ink">
              Per system policy, messages older than 30 days are automatically deleted. This action runs the cleanup now. Note: Individual messages cannot be deleted by any user.
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">Delete messages older than (days)</label>
            <input
              type="number"
              value={cleanupDays}
              onChange={(e) => setCleanupDays(Math.max(1, Number(e.target.value) || 1))}
              min={1}
              max={365}
              className="input w-full"
            />
            <p className="text-[10px] text-ink3 mt-1">Default retention is 30 days. Use a higher value to keep more history.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <button onClick={() => setCleanupOpen(false)} className="btn text-sm" disabled={cleanupBusy}>Cancel</button>
            <button onClick={handleCleanup} className="btn btn-primary text-sm flex items-center gap-1.5" disabled={cleanupBusy}>
              <RefreshCw size={14} className={cleanupBusy ? 'animate-spin' : ''} /> Run Cleanup
            </button>
          </div>
        </div>
      </Modal>

      <AttachmentViewer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        attachments={viewerAttachments}
        initialIndex={viewerIndex}
      />
    </div>
  );
}
