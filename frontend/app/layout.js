import './styles.css';

export const metadata = { title: 'Resume Builder and PDF Editor' };

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
