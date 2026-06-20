import React, { useState, useEffect } from 'react';
import { subscribeUsers, addUser, removeUser, checkCanJoin } from '../services/db';

const UserManagement = ({ onSelectUser }) => {
  const [users, setUsers] = useState({});
  const [newUserName, setNewUserName] = useState('');
  const [newChips, setNewChips] = useState(300);

  useEffect(() => {
    const unsubscribe = subscribeUsers((data) => setUsers(data));
    return () => unsubscribe();
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    const trimmedName = newUserName.trim();
    if (!trimmedName) {
      return;
    }
    
    // 检查是否重名
    const isDuplicate = Object.values(users).some(u => u.name === trimmedName);
    if (isDuplicate) {
      alert("该昵称已存在，请换一个名字！");
      return;
    }

    // Call without awaiting to unblock UI
    addUser(trimmedName, newChips)
      .catch((error) => {
        alert("添加用户失败: " + error.message);
        console.error("addUser error:", error);
      });
      
    // Optimistically clear the form
    setNewUserName('');
    setNewChips(300);
  };

  const handleRemoveUser = async (userId) => {
    if (window.confirm("确定要删除这个用户吗？")) {
      await removeUser(userId);
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: '20px 0' }}>
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '10px' }}>炸金花</h1>
        <p style={{ color: 'var(--text-muted)' }}>家庭局专用 · 春节娱乐</p>
      </div>

      <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '15px' }}>创建新用户</h3>
        <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input
            className="input-field"
            type="text"
            placeholder="输入昵称"
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            maxLength={10}
          />
          <input
            className="input-field"
            type="number"
            placeholder="初始筹码 (默认300)"
            value={newChips}
            onChange={(e) => setNewChips(Number(e.target.value))}
          />
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '5px' }}>
            添加用户
          </button>
        </form>
      </div>

      <div className="glass-panel" style={{ padding: '20px' }}>
        <h3 style={{ marginBottom: '15px' }}>选择你的身份</h3>
        {Object.keys(users).length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>暂无用户，请先创建</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {Object.entries(users).map(([id, user]) => (
              <div key={id} style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '10px 15px', borderRadius: '12px', justifyContent: 'space-between' }}>
                <div 
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flex: 1 }}
                  onClick={async () => {
                    const canJoin = await checkCanJoin();
                    if (!canJoin) {
                      alert("当前牌桌正在游戏中，暂不允许加入。请稍等这局打完！");
                      return;
                    }
                    onSelectUser(id, user);
                  }}
                >
                  <div className="avatar">
                    <img src={user.avatar} alt="avatar" />
                  </div>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '1.1rem' }}>{user.name}</div>
                    <div className="chip" style={{ marginTop: '4px' }}>💰 {user.chips}</div>
                  </div>
                </div>
                <button 
                  className="btn btn-outline" 
                  style={{ padding: '6px 12px', color: 'var(--danger-color)', borderColor: 'var(--danger-color)', fontSize: '0.8rem' }}
                  onClick={() => handleRemoveUser(id)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserManagement;
