const API_URL = 'http://localhost:3001';

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const response = await fetch(`${API_URL}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('signupEmail').value,
        password: document.getElementById('signupPassword').value,
        mainUserId: null // Adjust if needed
      })
    });
    const data = await response.json();
    const responseDiv = document.getElementById('signupResponse');
    if (response.ok) {
      responseDiv.className = 'response success';
      responseDiv.textContent = data.message;
    } else {
      responseDiv.className = 'response error';
      responseDiv.textContent = data.error;
    }
  } catch (err) {
    console.error('Error:', err);
  }
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
      })
    });
    const data = await response.json();
    const responseDiv = document.getElementById('loginResponse');
    if (response.ok) {
      responseDiv.className = 'response success';
      responseDiv.textContent = 'Login successful!';
      // Store tokens as needed
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
    } else {
      responseDiv.className = 'response error';
      responseDiv.textContent = data.error;
    }
  } catch (err) {
    console.error('Error:', err);
  }
});

// Redirect to Google OAuth endpoint on button click
document.getElementById('googleLogin').addEventListener('click', () => {
  window.location.href = `${API_URL}/google`;
});
