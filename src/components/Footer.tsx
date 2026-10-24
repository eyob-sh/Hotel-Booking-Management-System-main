import { Link } from "react-router-dom";
import {
  Mail,
  Phone,
  MapPin,
  Facebook,
  Twitter,
  Instagram,
  Linkedin,
  Building2,
} from "lucide-react";

const Footer = () => {
  return (
    <footer className="relative bg-gradient-to-br from-slate-900 via-primary-900 to-slate-900 text-white overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <div className="bg-white p-2 rounded-xl shadow-soft">
                <Building2 className="w-6 h-6 text-primary-600" />
              </div>
              <span className="text-2xl font-bold tracking-tight">BookInn</span>
            </div>
            <p className="text-slate-300 leading-relaxed text-sm">
              Book your stay directly with us and enjoy a comfortable,
              unforgettable experience. Secure booking, clear pricing, no
              hidden fees.
            </p>
            <div className="flex space-x-3 pt-2">
              {[
                { Icon: Facebook, href: "https://facebook.com", label: "Facebook" },
                { Icon: Twitter, href: "https://twitter.com", label: "Twitter" },
                { Icon: Instagram, href: "https://instagram.com", label: "Instagram" },
                { Icon: Linkedin, href: "https://linkedin.com", label: "LinkedIn" },
              ].map(({ Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-semibold tracking-wide uppercase text-slate-200">
              Quick Links
            </h3>
            <ul className="space-y-2.5">
              {[
                { to: "/", label: "Home" },
                { to: "/manage-booking", label: "Manage Booking" },
                { to: "/my-bookings", label: "My Bookings" },
                { to: "/api-docs", label: "API Docs" },
              ].map(({ to, label }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="text-slate-300 hover:text-white text-sm transition-colors inline-flex items-center gap-1 group"
                  >
                    <span className="w-1 h-1 rounded-full bg-slate-500 group-hover:bg-white transition-colors" />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-semibold tracking-wide uppercase text-slate-200">
              Support
            </h3>
            <ul className="space-y-2.5">
              {[
                { to: "/", label: "Help Center" },
                { to: "/", label: "Booking Guide" },
                { to: "/", label: "Cancellation Policy" },
                { to: "/api-status", label: "Service Status" },
              ].map(({ to, label }) => (
                <li key={label}>
                  <Link
                    to={to}
                    className="text-slate-300 hover:text-white text-sm transition-colors inline-flex items-center gap-1 group"
                  >
                    <span className="w-1 h-1 rounded-full bg-slate-500 group-hover:bg-white transition-colors" />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-semibold tracking-wide uppercase text-slate-200">
              Contact Us
            </h3>
            <div className="space-y-3">
              <a
                href="mailto:support@bookinn.com"
                className="flex items-center space-x-3 text-slate-300 hover:text-white transition-colors text-sm"
              >
                <Mail className="w-4 h-4 text-primary-300" />
                <span>support@bookinn.com</span>
              </a>
              <a
                href="tel:+251900000000"
                className="flex items-center space-x-3 text-slate-300 hover:text-white transition-colors text-sm"
              >
                <Phone className="w-4 h-4 text-primary-300" />
                <span>+251 90 000 0000</span>
              </a>
              <div className="flex items-center space-x-3 text-slate-300 text-sm">
                <MapPin className="w-4 h-4 text-primary-300" />
                <span>Addis Ababa, Ethiopia</span>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 mt-12 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-slate-400 text-sm">
            © 2025 BookInn. All rights reserved.
          </p>
          <div className="flex space-x-6">
            <Link
              to="/api-status"
              className="text-slate-400 hover:text-white text-sm transition-colors"
            >
              Status
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
EOF
file_path: src/components/Footer.tsx