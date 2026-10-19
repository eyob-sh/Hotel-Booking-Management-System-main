import Footer from "../components/Footer";
import Header from "../components/Header";
import { useLocation } from "react-router-dom";

interface Props {
  children: React.ReactNode;
}

const Layout = ({ children }: Props) => {
  const location = useLocation();
  const isHomePage = location.pathname === "/";

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      {isHomePage ? (
        <div className="flex-1">{children}</div>
      ) : (
        <div className="w-full px-2 sm:px-6 lg:px-8 py-10 flex-1">
          {children}
        </div>
      )}
      <Footer />
    </div>
  );
};

export default Layout;
