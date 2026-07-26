import React, { useState, useEffect } from 'react'

const UpdateModal = () => {
  const [show, setShow] = useState(false)
  const [updateInfo, setUpdateInfo] = useState(null)
  const [isMacosManual, setIsMacosManual] = useState(false)
  const [macosUrl, setMacosUrl] = useState('')

  useEffect(() => {
    // Check if an update is already downloaded on startup
    if (window.api && window.api.checkForUpdates) {
      window.api.checkForUpdates().then(res => {
        if (res.status === 'downloaded') {
          setIsMacosManual(false)
          setShow(true)
        }
      }).catch(() => {})
    }

    // Listen for downloaded updates (Windows/Linux)
    if (window.api && window.api.onUpdateDownloaded) {
      window.api.onUpdateDownloaded((info) => {
        setUpdateInfo(info)
        setIsMacosManual(false)
        setShow(true)
      })
    }

    // Listen for available manual updates (macOS)
    if (window.api && window.api.onUpdateAvailableMacos) {
      window.api.onUpdateAvailableMacos((url) => {
        setMacosUrl(url)
        setIsMacosManual(true)
        setShow(true)
      })
    }
    
    // Custom event to manually trigger the modal if it's already downloaded
    const handleShowUpdateModal = () => {
      setShow(true)
    }
    window.addEventListener('show-update-modal', handleShowUpdateModal)

    return () => {
      window.removeEventListener('show-update-modal', handleShowUpdateModal)
    }
  }, [])

  if (!show) return null

  const handleRestart = () => {
    if (window.api && window.api.installUpdate) {
      window.api.installUpdate()
    }
  }

  const handleDownload = () => {
    if (window.api && window.api.openUrl) {
      window.api.openUrl(macosUrl)
    }
    setShow(false)
  }

  const handleLater = () => {
    setShow(false)
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={iconContainerStyle}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue, #007acc)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </div>
        
        <h2 style={titleStyle}>
          {isMacosManual ? 'Update Available' : 'Update Ready to Install'}
        </h2>
        
        <p style={messageStyle}>
          {isMacosManual 
            ? `A new version of comπle Editor is available on GitHub. Would you like to download it now?`
            : `A new version of comπle Editor ${updateInfo?.version ? `(v${updateInfo.version}) ` : ''}has been downloaded in the background. Restart the application to apply the updates.`}
        </p>

        {updateInfo?.releaseNotes && (
          <div style={{ textAlign: 'left', background: 'var(--bg-input)', padding: '12px', borderRadius: '6px', marginBottom: '20px', width: '100%', maxHeight: '120px', overflowY: 'auto', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <div dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }} />
          </div>
        )}

        <div style={buttonContainerStyle}>
          <button 
            style={secondaryButtonStyle} 
            onClick={handleLater}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover, #2a2a2a)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            Later
          </button>
          <button 
            style={primaryButtonStyle} 
            onClick={isMacosManual ? handleDownload : handleRestart}
            onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
            onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
          >
            {isMacosManual ? 'Download Now' : 'Restart & Update'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 9999,
  animation: 'fadeIn 0.2s ease-out'
}

const modalStyle = {
  backgroundColor: 'var(--bg-surface, #1e1e1e)',
  border: '1px solid var(--border-base, #333)',
  borderRadius: '12px',
  padding: '32px',
  width: '100%',
  maxWidth: '400px',
  boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center'
}

const iconContainerStyle = {
  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
  borderRadius: '50%',
  width: '80px',
  height: '80px',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  marginBottom: '20px',
  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
}

const titleStyle = {
  margin: '0 0 12px 0',
  color: 'var(--text-primary, #fff)',
  fontSize: '1.25rem',
  fontWeight: '600'
}

const messageStyle = {
  margin: '0 0 28px 0',
  color: 'var(--text-secondary, #aaa)',
  fontSize: '0.95rem',
  lineHeight: '1.5'
}

const buttonContainerStyle = {
  display: 'flex',
  gap: '12px',
  width: '100%',
  justifyContent: 'flex-end'
}

const buttonBase = {
  padding: '10px 20px',
  borderRadius: '6px',
  fontSize: '0.9rem',
  fontWeight: '500',
  cursor: 'pointer',
  border: 'none',
  transition: 'all 0.15s ease'
}

const primaryButtonStyle = {
  ...buttonBase,
  backgroundColor: 'var(--accent-blue, #007acc)',
  color: 'var(--bg-deep, #fff)',
  flex: 1
}

const secondaryButtonStyle = {
  ...buttonBase,
  backgroundColor: 'transparent',
  border: '1px solid var(--border-base, #444)',
  color: 'var(--text-secondary, #ccc)',
  flex: 1
}

export default UpdateModal
