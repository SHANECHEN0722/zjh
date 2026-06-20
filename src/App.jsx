import React, { useState, useEffect } from 'react';
import UserManagement from './components/UserManagement';
import GameTable from './components/GameTable';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Check connection
    const connectedRef = ref(db, ".info/connected");
    const unsub = onValue(connectedRef, (snap) => {
      setConnected(snap.val() === true);
    });

    // Check sessionStorage for saved identity
    const savedUserId = sessionStorage.getItem('zjh_userId');
    const savedUserName = sessionStorage.getItem('zjh_userName');
    const savedAvatar = sessionStorage.getItem('zjh_avatar');
    
    if (savedUserId && savedUserName) {
      setCurrentUser({ id: savedUserId, name: savedUserName, avatar: savedAvatar });
    }

    return () => unsub();
  }, []);

  const handleSelectUser = (id, user) => {
    sessionStorage.setItem('zjh_userId', id);
    sessionStorage.setItem('zjh_userName', user.name);
    if (user.avatar) sessionStorage.setItem('zjh_avatar', user.avatar);
    setCurrentUser({ id, name: user.name, avatar: user.avatar });
  };

  const handleLogout = () => {
    sessionStorage.removeItem('zjh_userId');
    sessionStorage.removeItem('zjh_userName');
    sessionStorage.removeItem('zjh_avatar');
    setCurrentUser(null);
  };

  return (
    <div className="app-container">
      {!connected && (
        <div style={{ background: '#ef4444', color: 'white', padding: '10px', textAlign: 'center', borderRadius: '8px', marginBottom: '15px' }}>
          网络未连接或数据库配置错误，正在尝试连接...
        </div>
      )}
      {!currentUser ? (
        <UserManagement onSelectUser={handleSelectUser} />
      ) : (
        <GameTable currentUser={currentUser} onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;
