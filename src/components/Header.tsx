import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import useAppContext from "../hooks/useAppContext";
import useSearchContext from "../hooks/useSearchContext";
import SignOutButton from "./SignOutButton";
import { BarChart3, Building2, Calendar, LogIn, Menu, X, Settings } from "lucide-react";

const Header = () => {
  const { isLoggedIn, user } = useAppContext();
  const role = user?.role;
  const search = useSearchContext();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogoClick = () => {
    search.clearSearchValues();
    navigate("/");
    setMobileOpen(false);
  };

  const navLinkClass =
    "flex items-center text-white/90 hover:text-white px-4 py-2 rounded-lg font-medium hover:bg-white/10 transition-all duration-200 group";

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-primary-600/90 shadow-medium border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-3">
          <button onClick={handleLogoClick} className="flex items-center space-x-2 group">
            <div className="bg-white p-2 rounded-xl shadow-soft group-hover:shadow-medium transition-all duration-300 group-hover:scale-105">
              <Building2 className="w-6 h-6 text-primary-600" />
            </div>
            <span className="text-2xl font-bold text-white tracking-tight group-hover:text-primary-100 transition-colors">
              BookInn
            </span>
          </button>

          <nav className="hidden md:flex items-center space-x-1">
            {isLoggedIn ? (
              <>
                {role === "admin" && (
                  <Link className={navLinkClass} to="/admin" onClick={closeMobile}>
                    <BarChart3 className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
                    Admin
                  </Link>
                )}

                <Link className={navLinkClass} to="/my-bookings" onClick={closeMobile}>
                  <Calendar className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
                  My Bookings
                </Link>

                {role === "hotel_owner" && (
                  <Link className={navLinkClass} to="/my-hotels" onClick={closeMobile}>
                    <Building2 className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
                    My Hotels
                  </Link>
                )}

                {(role === "hotel_owner" || role === "admin") && (
                  <Link className={navLinkClass} to="/settings" onClick={closeMobile}>
                    <Settings className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
                    Settings
                  </Link>
                )}

                <SignOutButton />
              </>
            ) : (
              <Link
                to="/sign-in"
                onClick={closeMobile}
                className="flex items-center bg-white text-primary-600 px-6 py-2 rounded-xl font-semibold hover:bg-primary-50 hover:shadow-medium transition-all duration-200 group"
              >
                <LogIn className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
                Sign In
              </Link>
            )}
          </nav>

          <div className="md:hidden">
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-white/10 bg-primary-600/95 backdrop-blur-md">
          <nav className="max-w-7xl mx-auto px-4 py-4 flex flex-col space-y-1">
            {isLoggedIn ? (
              <>
                {role === "admin" && (
                  <Link className={navLinkClass} to="/admin" onClick={closeMobile}>
                    <BarChart3 className="w-4 h-4 mr-2" /> Admin
                  </Link>
                )}
                <Link className={navLinkClass} to="/my-bookings" onClick={closeMobile}>
                  <Calendar className="w-4 h-4 mr-2" /> My Bookings
                </Link>
                {role === "hotel_owner" && (
                  <Link className={navLinkClass} to="/my-hotels" onClick={closeMobile}>
                    <Building2 className="w-4 h-4 mr-2" /> My Hotels
                  </Link>
                )}
                {(role === "hotel_owner" || role === "admin") && (
                  <Link className={navLinkClass} to="/settings" onClick={closeMobile}>
                    <Settings className="w-4 h-4 mr-2" /> Settings
                  </Link>
                )}
                <div className="pt-2">
                  <SignOutButton />
                </div>
              </>
            ) : (
              <Link
                to="/sign-in"
                onClick={closeMobile}
                className="flex items-center bg-white text-primary-600 px-6 py-2 rounded-xl font-semibold hover:bg-primary-50 transition-colors"
              >
                <LogIn className="w-4 h-4 mr-2" /> Sign In
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
EOF
file_path: src/components/Header.tsx