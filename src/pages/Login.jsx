import { useState } from 'react';
import { getDb } from '../db/Database';
import './Login.css';

export default function Login({ onLogin }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!username || !password) {
            setError('Please enter both username and password.');
            return;
        }

        try {
            const db = await getDb();
            const result = await db.select(
                'SELECT * FROM users WHERE username = $1 AND password = $2',
                [username, password]
            );

            if (result.length > 0) {
                const user = result[0];
                const permissions = JSON.parse(user.permissions);
                onLogin({ id: user.id, username: user.username, permissions });
            } else {
                setError('Invalid username or password.');
            }
        } catch (err) {
            console.error("Login Error:", err);
            setError('An error occurred during login.');
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-logo">Login</div>
                <div className="login-subtitle">Sign in to access your analytics dashboard</div>

                {error && <div className="login-error">{error}</div>}

                <form className="login-form" onSubmit={handleSubmit}>
                    <div>
                        <label>Username</label>
                        <input
                            type="text"
                            className="login-input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter your username"
                        />
                    </div>
                    <div>
                        <label>Password</label>
                        <input
                            type="password"
                            className="login-input"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                        />
                    </div>
                    <button type="submit" className="login-btn">Log In</button>
                </form>
            </div>
        </div>
    );
}
