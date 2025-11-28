import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: "/chats",
      permanent: false,
    },
  };
};

export default function HistoryRedirect() {
  return null;
}
