// public/js/crossing.js

(function() {
  'use strict';

  // Get APS ID from URL path (e.g., /crossing/APS-1)
  const getApsId = () => {
    const pathParts = window.location.pathname.split('/');
    return pathParts[pathParts.length - 1];
  };

  const apsId = getApsId();

  // ========== Community Reports Section ==========
  const initCommunityReports = () => {
    const reportsSection = document.querySelector('.community-reports');
    if (!reportsSection) return;

    // Handle voting on reports
    const voteButtons = reportsSection.querySelectorAll('.vote-btn');
    voteButtons.forEach(btn => {
      btn.addEventListener('click', handleVote);
    });

    // Handle duplicate flagging
    const duplicateButtons = reportsSection.querySelectorAll('.flag-duplicate-btn');
    duplicateButtons.forEach(btn => {
      btn.addEventListener('click', handleDuplicateFlag);
    });
  };

  const handleVote = async (e) => {
    const button = e.target;
    const reportId = button.dataset.reportId;
    const voteType = button.dataset.voteType;

    try {
      const response = await fetch(`/api/reports/${reportId}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ voteType })
      });

      if (!response.ok) {
        throw new Error('Failed to submit vote');
      }

      const data = await response.json();
      
      // Update the trust score in the UI
      const scoreElement = button.closest('.report').querySelector('.trust-score');
      if (scoreElement) {
        scoreElement.textContent = data.newTrustScore || data.trustScore || 0;
      }

      // Visual feedback
      button.classList.add('voted');
      setTimeout(() => button.classList.remove('voted'), 300);

      showNotification('Vote submitted!', 'success');

    } catch (error) {
      console.error('Vote error:', error);
      showNotification('Failed to submit vote. Please try again.', 'error');
    }
  };

  const handleDuplicateFlag = async (e) => {
    const button = e.target;
    const reportId = button.dataset.reportId;

    if (!confirm('Are you sure you want to flag this report as a duplicate?')) {
      return;
    }

    try {
      const response = await fetch(`/api/reports/${reportId}/flag-duplicate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to flag as duplicate');
      }

      // Add duplicate flag to UI
      const report = button.closest('.report');
      let duplicateFlag = report.querySelector('.duplicate-flag');
      
      if (!duplicateFlag) {
        duplicateFlag = document.createElement('div');
        duplicateFlag.classList.add('duplicate-flag');
        duplicateFlag.textContent = 'Marked as duplicate';
        report.appendChild(duplicateFlag);
      }

      button.disabled = true;
      showNotification('Report flagged as duplicate', 'success');

    } catch (error) {
      console.error('Flag error:', error);
      showNotification('Failed to flag report. Please try again.', 'error');
    }
  };

  // ========== Submit Report Form (AJAX) ==========
  const initReportForm = () => {
    const form = document.getElementById('report-form');
    if (!form) return;

    form.addEventListener('submit', handleReportSubmit);

    // Optional: Image preview
    const photoInput = form.querySelector('input[type="file"]');
    if (photoInput) {
      photoInput.addEventListener('change', handleImagePreview);
    }
  };

  const handleReportSubmit = async (e) => {
    e.preventDefault();

    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const reportText = form.querySelector('[name="reportText"]').value.trim();
    const photoInput = form.querySelector('[name="photo"]');

    // Basic validation
    if (!reportText || reportText.length < 10) {
      showNotification('Report must be at least 10 characters long', 'error');
      return;
    }

    // Disable submit button during submission
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';

    try {
      // Create FormData for file upload support
      const formData = new FormData();
      formData.append('targetType', 'crossing');
      formData.append('targetId', apsId);
      formData.append('text', reportText);
      
      // Add photo if exists
      if (photoInput.files && photoInput.files[0]) {
        formData.append('photo', photoInput.files[0]);
      }

      const response = await fetch('/api/reports', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit report');
      }

      const data = await response.json();

      // Show success message
      showNotification('Report submitted successfully!', 'success');

      // Reset form
      form.reset();

      // Clear image preview if exists
      const preview = document.getElementById('image-preview');
      if (preview) {
        preview.innerHTML = '';
      }

      // Add new report to the list
      addReportToList(data.report || data);

    } catch (error) {
      console.error('Submit error:', error);
      showNotification(error.message || 'Failed to submit report. Please try again.', 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Submit Report';
    }
  };

  const handleImagePreview = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      showNotification('Please select an image file', 'error');
      e.target.value = '';
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      showNotification('Image must be smaller than 5MB', 'error');
      e.target.value = '';
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (event) => {
      let preview = document.getElementById('image-preview');
      if (!preview) {
        preview = document.createElement('div');
        preview.id = 'image-preview';
        e.target.parentElement.appendChild(preview);
      }

      preview.innerHTML = `
        <img src="${event.target.result}" alt="Preview" style="max-width: 200px; max-height: 200px; border-radius: 4px; margin-top: 8px;">
        <button type="button" class="remove-preview" style="display: block; margin-top: 4px;">Remove Image</button>
      `;

      // Handle remove preview
      preview.querySelector('.remove-preview').addEventListener('click', () => {
        e.target.value = '';
        preview.innerHTML = '';
      });
    };
    reader.readAsDataURL(file);
  };

  const addReportToList = (report) => {
    const reportsList = document.querySelector('.reports-list');
    if (!reportsList) return;

    // Remove "no reports" message if it exists
    const noReportsMsg = reportsList.querySelector('.no-reports');
    if (noReportsMsg) {
      noReportsMsg.remove();
    }

    // Create or get the <ul> element
    let ul = reportsList.querySelector('ul');
    if (!ul) {
      ul = document.createElement('ul');
      reportsList.appendChild(ul);
    }

    const li = document.createElement('li');
    const reportId = report._id || report.reportId;
    const trustScore = report.trustScore || 0;
    const statusClass = report.status || 'open';
    
    li.innerHTML = `
      <div class="report report-${statusClass}" data-report-id="${reportId}">
        <p class="report-text">${escapeHtml(report.text)}</p>
        ${report.photo ? `<img src="${escapeHtml(report.photo)}" alt="Report Photo" loading="lazy" class="report-photo" />` : ''}
        <div class="report-meta">
          <span class="votes">Trust Score: <span class="trust-score">${trustScore}</span></span>
          <span class="report-status">${statusClass}</span>
          <span class="report-time">Just now</span>
        </div>
        <div class="report-actions">
          <button class="vote-btn" data-report-id="${reportId}" data-vote-type="up">👍 Helpful</button>
          <button class="vote-btn" data-report-id="${reportId}" data-vote-type="down">👎 Not Helpful</button>
          <button class="flag-duplicate-btn" data-report-id="${reportId}">Flag Duplicate</button>
        </div>
      </div>
    `;

    ul.insertBefore(li, ul.firstChild);

    // Attach event listeners to new buttons
    const newReport = li.querySelector('.report');
    newReport.querySelectorAll('.vote-btn').forEach(btn => {
      btn.addEventListener('click', handleVote);
    });
    newReport.querySelector('.flag-duplicate-btn').addEventListener('click', handleDuplicateFlag);

    // Scroll to new report
    li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ========== Utility Functions ==========
  const showNotification = (message, type = 'info') => {
    // Remove existing notifications
    const existing = document.querySelector('.notification');
    if (existing) {
      existing.remove();
    }

    const notification = document.createElement('div');
    notification.classList.add('notification', `notification-${type}`);
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      border-radius: 8px;
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      font-weight: 500;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      z-index: 1000;
      animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  };

  const escapeHtml = (text) => {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // ========== Initialize Everything ==========
  const init = () => {
    initCommunityReports();
    initReportForm();
    
    console.log('Crossing page initialized for APS:', apsId);
  };

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();